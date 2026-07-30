import { ModelError, internalSpan } from "./diagnostics.js";
import type { IREntity, IRField, ModelIR } from "./ir.js";
import { quoteIdent } from "./naming.js";

export type RenameOperation =
  | { kind: "renameEntity"; entityId: string; from: string; to: string }
  | { kind: "renameField"; entityId: string; fieldId: string; table: string; from: string; to: string };

export interface MigrationPlan {
  previousVersion: string;
  currentVersion: string;
  operations: RenameOperation[];
  sql: string;
}

function fail(ir: ModelIR, code: string, message: string): never {
  throw new ModelError(code, message, internalSpan(), ir.model.sourceFile);
}

function byId<T extends { id: string }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]));
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  const ignored = new Set(["id", "span", "sourceExpression", "naming", "fieldName", "target"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .map(([key, child]) => [key, comparable(child)]));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function requireExplicitIds(ir: ModelIR): void {
  for (const entity of ir.entities) {
    if (entity.identity?.strategy !== "explicitStableId") {
      fail(ir, "E2804", `Migration planning requires an explicit @stableId on entity '${entity.name}'.`);
    }
    for (const field of entity.fields) {
      if (field.identity?.strategy !== "explicitStableId") {
        fail(ir, "E2804", `Migration planning requires an explicit @stableId on field '${entity.name}.${field.name}'.`);
      }
    }
  }
}

function requireSameIds<T extends { id: string; name: string }>(
  previous: T[],
  current: T[],
  subject: string,
  ir: ModelIR,
): void {
  const previousIds = new Set(previous.map((value) => value.id));
  const currentIds = new Set(current.map((value) => value.id));
  const removed = previous.filter((value) => !currentIds.has(value.id));
  const added = current.filter((value) => !previousIds.has(value.id));
  if (removed.length || added.length) {
    fail(ir, "E2805", `${subject} additions/removals or changed stable IDs are unsupported in 0.5 (removed: ${removed.map((value) => value.name).join(", ") || "none"}; added: ${added.map((value) => value.name).join(", ") || "none"}).`);
  }
}

function fieldStructure(field: IRField): unknown {
  const { name: _name, identity: _identity, ...structure } = field;
  return structure;
}

function entityStructure(entity: IREntity): unknown {
  const { name: _name, identity: _identity, fields: _fields, ...structure } = entity;
  return structure;
}

export function planMigration(previous: ModelIR, current: ModelIR): MigrationPlan {
  if (previous.irVersion !== 5 || current.irVersion !== 5) {
    fail(current, "E2803", "Migration planning requires canonical IR version 5 inputs.");
  }
  requireExplicitIds(previous);
  requireExplicitIds(current);
  if (previous.model.id !== current.model.id
    || previous.model.name !== current.model.name
    || previous.model.naming.sqlSchema !== current.model.naming.sqlSchema
    || previous.model.naming.internalSchema !== current.model.naming.internalSchema) {
    fail(current, "E2806", "Model identity, name, and schema must remain unchanged in a 0.5 rename migration.");
  }
  if (!same(previous.enums, current.enums)
    || !same(previous.actions, current.actions)
    || !same(previous.queries, current.queries)
    || previous.principal.entityId !== current.principal.entityId) {
    fail(current, "E2807", "Enums, actions, queries, and principal semantics must remain unchanged in a 0.5 rename migration.");
  }

  requireSameIds(previous.entities, current.entities, "Entity", current);
  const previousEntities = byId(previous.entities);
  const operations: RenameOperation[] = [];

  for (const currentEntity of current.entities) {
    const previousEntity = previousEntities.get(currentEntity.id)!;
    if (!same(entityStructure(previousEntity), entityStructure(currentEntity))) {
      fail(current, "E2807", `Entity structure changed for '${currentEntity.name}'; only names may change in 0.5.`);
    }
    requireSameIds(previousEntity.fields, currentEntity.fields, `Field in entity '${currentEntity.name}'`, current);
    const previousFields = byId(previousEntity.fields);
    for (const currentField of currentEntity.fields) {
      const previousField = previousFields.get(currentField.id)!;
      if (!same(fieldStructure(previousField), fieldStructure(currentField))) {
        fail(current, "E2807", `Field structure changed for '${currentEntity.name}.${currentField.name}'; only names may change in 0.5.`);
      }
    }
    if (previousEntity.naming.sqlTable !== currentEntity.naming.sqlTable) {
      if (previous.entities.some((candidate) => candidate.id !== currentEntity.id && candidate.naming.sqlTable === currentEntity.naming.sqlTable)) {
        fail(current, "E2808", `Table rename target '${currentEntity.naming.sqlTable}' collides with an existing table.`);
      }
      operations.push({
        kind: "renameEntity",
        entityId: currentEntity.id,
        from: previousEntity.naming.sqlTable,
        to: currentEntity.naming.sqlTable,
      });
    }
    for (const currentField of currentEntity.fields) {
      const previousField = previousFields.get(currentField.id)!;
      if (previousField.naming.sqlColumn === currentField.naming.sqlColumn) continue;
      if (previousEntity.fields.some((candidate) => candidate.id !== currentField.id && candidate.naming.sqlColumn === currentField.naming.sqlColumn)) {
        fail(current, "E2808", `Column rename target '${currentEntity.naming.sqlTable}.${currentField.naming.sqlColumn}' collides with an existing column.`);
      }
      operations.push({
        kind: "renameField",
        entityId: currentEntity.id,
        fieldId: currentField.id,
        table: currentEntity.naming.sqlTable,
        from: previousField.naming.sqlColumn,
        to: currentField.naming.sqlColumn,
      });
    }
  }

  const schema = quoteIdent(current.model.naming.sqlSchema);
  const statements = operations.map((operation) => operation.kind === "renameEntity"
    ? `ALTER TABLE ${schema}.${quoteIdent(operation.from)} RENAME TO ${quoteIdent(operation.to)};`
    : `ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME COLUMN ${quoteIdent(operation.from)} TO ${quoteIdent(operation.to)};`);
  const sql = [
    `-- ModelLang rename migration ${previous.model.version} -> ${current.model.version}`,
    "BEGIN;",
    ...(statements.length ? statements : ["-- No semantic renames detected."]),
    "COMMIT;",
    "-- Next apply the current generated 003_actions.sql, 003_queries.sql, and 004_grants.sql.",
    "",
  ].join("\n");
  return {
    previousVersion: previous.model.version,
    currentVersion: current.model.version,
    operations,
    sql,
  };
}
