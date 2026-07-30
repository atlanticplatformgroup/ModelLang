import { ModelError, internalSpan } from "./diagnostics.js";
import type {
  IRAction, IREntity, IREnum, IREnumMember, IRField, IRInvariant, IRQuery,
  IRTemporalExclusion, IRWorkflow, ModelIR,
} from "./ir.js";
import { isMoneyType } from "./money.js";
import { quoteIdent, snakeCase } from "./naming.js";

export type RenameOperation =
  | { kind: "renameEntity"; entityId: string; from: string; to: string }
  | { kind: "renameField"; entityId: string; fieldId: string; table: string; from: string; to: string }
  | { kind: "renameEnum"; enumId: string; from: string; to: string }
  | { kind: "renameInvariant"; entityId: string; invariantId: string; table: string; from: string; to: string }
  | { kind: "renameExclusion"; entityId: string; exclusionId: string; table: string; from: string; to: string; validFrom: string; validTo: string }
  | { kind: "renameAction"; actionId: string; from: string; to: string; parameterTypes: string[] }
  | { kind: "renameQuery"; queryId: string; from: string; to: string; parameterTypes: string[] };

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
  const ignored = new Set(["id", "span", "sourceExpression", "naming", "fieldName", "memberName", "target"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .map(([key, child]) => [key, comparable(child)]));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function requireExplicit(
  ir: ModelIR,
  value: { id: string; name: string; identity?: { strategy: string; stableId?: string } },
  subject: string,
  semanticPrefix: string,
): void {
  if (value.identity?.strategy !== "explicitStableId"
    || !value.identity.stableId
    || value.id !== `${semanticPrefix}:${value.identity.stableId}`) {
    fail(ir, "E2804", `Migration planning requires an explicit @stableId on ${subject} '${value.name}'.`);
  }
}

function requireExplicitIds(ir: ModelIR): void {
  for (const enumeration of ir.enums) {
    requireExplicit(ir, enumeration, "enum", "enum");
    for (const member of enumeration.members) requireExplicit(ir, member, `enum member in '${enumeration.name}'`, "enumMember");
  }
  for (const entity of ir.entities) {
    requireExplicit(ir, entity, "entity", "entity");
    for (const field of entity.fields) requireExplicit(ir, field, `field in '${entity.name}'`, "field");
    for (const invariant of entity.invariants) requireExplicit(ir, invariant, `invariant in '${entity.name}'`, "invariant");
    for (const exclusion of entity.temporalExclusions) requireExplicit(ir, exclusion, `exclusion in '${entity.name}'`, "exclusion");
  }
  for (const action of ir.actions) requireExplicit(ir, action, "action", "action");
  for (const query of ir.queries) requireExplicit(ir, query, "query", "query");
  for (const workflow of ir.workflows) {
    requireExplicit(ir, workflow, "workflow", "workflow");
    for (const transition of workflow.transitions) {
      requireExplicit(ir, transition, `transition in '${workflow.name}'`, "transition");
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
    fail(ir, "E2805", `${subject} additions/removals or changed stable IDs are unsupported in 0.9 (removed: ${removed.map((value) => value.name).join(", ") || "none"}; added: ${added.map((value) => value.name).join(", ") || "none"}).`);
  }
}

function fieldStructure(field: IRField): unknown {
  const { name: _name, identity: _identity, ...structure } = field;
  return structure;
}

function enumStructure(enumeration: IREnum): unknown {
  const { name: _name, identity: _identity, members: _members, ...structure } = enumeration;
  return structure;
}

function enumMemberStructure(member: IREnumMember): unknown {
  const { name: _name, identity: _identity, ...structure } = member;
  return structure;
}

function invariantStructure(invariant: IRInvariant): unknown {
  const { name: _name, identity: _identity, ...structure } = invariant;
  return structure;
}

function exclusionStructure(exclusion: IRTemporalExclusion): unknown {
  const { name: _name, identity: _identity, ...structure } = exclusion;
  return structure;
}

function entityStructure(entity: IREntity): unknown {
  const {
    name: _name, identity: _identity, fields: _fields, invariants: _invariants,
    temporalExclusions: _temporalExclusions, ...structure
  } = entity;
  return structure;
}

function actionStructure(action: IRAction): unknown {
  const { name: _name, identity: _identity, ...structure } = action;
  return structure;
}

function queryStructure(query: IRQuery): unknown {
  const { name: _name, identity: _identity, ...structure } = query;
  return structure;
}

function workflowStructure(workflow: IRWorkflow): unknown {
  const { identity: _identity, ...structure } = workflow;
  return structure;
}

function sqlType(type: string): string {
  if (type.startsWith("entity:")) return "uuid";
  if (type.startsWith("set:enum:")) return "text[]";
  if (type.startsWith("enum:")) return "text";
  if (isMoneyType(type)) return "numeric";
  const scalar: Record<string, string> = {
    String: "text",
    Int: "bigint",
    Decimal: "numeric",
    Boolean: "boolean",
    UUID: "uuid",
    DateTime: "timestamptz",
  };
  const result = scalar[type];
  if (!result) throw new Error(`E4003 Unsupported SQL type ${type}`);
  return result;
}

function callableSqlTypes(operation: IRAction | IRQuery): string[] {
  return operation.callableParameters.map((id) => sqlType(operation.parameters.find((parameter) => parameter.id === id)!.type));
}

function collides<T extends { id: string }>(
  values: T[],
  id: string,
  physicalName: (value: T) => string,
  target: string,
): boolean {
  return values.some((candidate) => candidate.id !== id && physicalName(candidate) === target);
}

function constraintNames(entity: IREntity): string[] {
  const names: string[] = [];
  for (const field of entity.fields) {
    if (field.annotations.some((annotation) => annotation.name === "id")) {
      names.push(`${entity.naming.sqlTable}_pkey`);
    }
    if (field.type.startsWith("entity:")) names.push(`fk_${entity.naming.sqlTable}_${field.naming.sqlColumn}`);
    if (field.type.startsWith("set:enum:")) names.push(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum_set`);
    else if (field.type.startsWith("enum:")) names.push(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum`);
    if (isMoneyType(field.type)) names.push(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_money`);
    for (const annotation of field.annotations) {
      if (annotation.name === "unique") names.push(`uq_${entity.naming.sqlTable}_${field.naming.sqlColumn}_unique`);
      if (annotation.name === "min" || annotation.name === "minExclusive" || annotation.name === "max") {
        names.push(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_${snakeCase(annotation.name)}`);
      }
    }
  }
  names.push(...entity.invariants.map((invariant) => invariant.naming.sqlConstraint));
  for (const exclusion of entity.temporalExclusions) {
    names.push(exclusion.naming.sqlValidIntervalConstraint, exclusion.naming.sqlExclusionConstraint);
  }
  return names;
}

function constraintTargetCollides(entity: IREntity, ignored: Set<string>, target: string): boolean {
  return constraintNames(entity).some((name) => !ignored.has(name) && name === target);
}

function duplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function requireUniquePhysicalTargets(ir: ModelIR): void {
  const table = duplicate(ir.entities.map((entity) => entity.naming.sqlTable));
  if (table) fail(ir, "E2808", `Table rename target '${table}' is not unique.`);
  for (const entity of ir.entities) {
    const column = duplicate(entity.fields.map((field) => field.naming.sqlColumn));
    if (column) fail(ir, "E2808", `Column rename target '${entity.naming.sqlTable}.${column}' is not unique.`);
    const constraint = duplicate(constraintNames(entity));
    if (constraint) fail(ir, "E2808", `Constraint rename target '${entity.naming.sqlTable}.${constraint}' is not unique.`);
  }
  const fn = duplicate([...ir.actions, ...ir.queries].map((operation) => operation.naming.sqlFunction));
  if (fn) fail(ir, "E2808", `Generated function rename target '${fn}' is not unique.`);
}

export function planMigration(previous: ModelIR, current: ModelIR): MigrationPlan {
  if (previous.irVersion !== 9 || current.irVersion !== 9) {
    fail(current, "E2803", "Migration planning requires canonical IR version 9 inputs.");
  }
  requireExplicitIds(previous);
  requireExplicitIds(current);
  if (previous.model.id !== current.model.id
    || previous.model.name !== current.model.name
    || previous.model.naming.sqlSchema !== current.model.naming.sqlSchema
    || previous.model.naming.internalSchema !== current.model.naming.internalSchema) {
    fail(current, "E2806", "Model identity, name, and schema must remain unchanged in a 0.9 rename migration.");
  }
  if (previous.principal.entityId !== current.principal.entityId) {
    fail(current, "E2807", "Principal semantics changed; only stable declaration renames are supported in 0.9.");
  }
  requireUniquePhysicalTargets(current);

  const operations: RenameOperation[] = [];

  requireSameIds(previous.workflows, current.workflows, "Workflow", current);
  const previousWorkflows = byId(previous.workflows);
  for (const currentWorkflow of current.workflows) {
    const previousWorkflow = previousWorkflows.get(currentWorkflow.id)!;
    requireSameIds(previousWorkflow.transitions, currentWorkflow.transitions, `Transition in workflow '${currentWorkflow.name}'`, current);
    if (JSON.stringify(previousWorkflow.naming) !== JSON.stringify(currentWorkflow.naming)
      || !same(workflowStructure(previousWorkflow), workflowStructure(currentWorkflow))) {
      fail(current, "E2807", `Workflow '${currentWorkflow.name}' changed; workflow migrations are intentionally unsupported in 0.9 and must be reviewed manually.`);
    }
  }

  requireSameIds(previous.enums, current.enums, "Enum", current);
  const previousEnums = byId(previous.enums);
  for (const currentEnum of current.enums) {
    const previousEnum = previousEnums.get(currentEnum.id)!;
    if (!same(enumStructure(previousEnum), enumStructure(currentEnum))) {
      fail(current, "E2807", `Enum structure changed for '${currentEnum.name}'; only its declaration name may change in 0.9.`);
    }
    requireSameIds(previousEnum.members, currentEnum.members, `Member in enum '${currentEnum.name}'`, current);
    const previousMembers = byId(previousEnum.members);
    for (const currentMember of currentEnum.members) {
      const previousMember = previousMembers.get(currentMember.id)!;
      if (previousMember.name !== currentMember.name) {
        fail(current, "E2807", `Enum member rename '${previousEnum.name}.${previousMember.name}' -> '${currentEnum.name}.${currentMember.name}' is identified by stable ID but stored-value migration is unsupported in 0.9.`);
      }
      if (!same(enumMemberStructure(previousMember), enumMemberStructure(currentMember))) {
        fail(current, "E2807", `Enum member structure changed for '${currentEnum.name}.${currentMember.name}'.`);
      }
    }
    if (previousEnum.name !== currentEnum.name) {
      operations.push({ kind: "renameEnum", enumId: currentEnum.id, from: previousEnum.name, to: currentEnum.name });
    }
  }

  requireSameIds(previous.entities, current.entities, "Entity", current);
  const previousEntities = byId(previous.entities);
  for (const currentEntity of current.entities) {
    const previousEntity = previousEntities.get(currentEntity.id)!;
    if (!same(entityStructure(previousEntity), entityStructure(currentEntity))) {
      fail(current, "E2807", `Entity structure changed for '${currentEntity.name}'; only declaration names may change in 0.9.`);
    }
    requireSameIds(previousEntity.fields, currentEntity.fields, `Field in entity '${currentEntity.name}'`, current);
    const previousFields = byId(previousEntity.fields);
    for (const currentField of currentEntity.fields) {
      const previousField = previousFields.get(currentField.id)!;
      if (!same(fieldStructure(previousField), fieldStructure(currentField))) {
        fail(current, "E2807", `Field structure changed for '${currentEntity.name}.${currentField.name}'; only its name may change in 0.9.`);
      }
    }

    if (previousEntity.naming.sqlTable !== currentEntity.naming.sqlTable) {
      if (collides(previous.entities, currentEntity.id, (candidate) => candidate.naming.sqlTable, currentEntity.naming.sqlTable)) {
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
      if (collides(previousEntity.fields, currentField.id, (candidate) => candidate.naming.sqlColumn, currentField.naming.sqlColumn)) {
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

    requireSameIds(previousEntity.invariants, currentEntity.invariants, `Invariant in entity '${currentEntity.name}'`, current);
    const previousInvariants = byId(previousEntity.invariants);
    for (const currentInvariant of currentEntity.invariants) {
      const previousInvariant = previousInvariants.get(currentInvariant.id)!;
      if (!same(invariantStructure(previousInvariant), invariantStructure(currentInvariant))) {
        fail(current, "E2807", `Invariant semantics changed for '${currentEntity.name}.${currentInvariant.name}'; only its name may change in 0.9.`);
      }
      if (previousInvariant.naming.sqlConstraint !== currentInvariant.naming.sqlConstraint) {
        if (constraintTargetCollides(
          previousEntity,
          new Set([previousInvariant.naming.sqlConstraint]),
          currentInvariant.naming.sqlConstraint,
        )) {
          fail(current, "E2808", `Constraint rename target '${currentEntity.naming.sqlTable}.${currentInvariant.naming.sqlConstraint}' collides with an existing constraint.`);
        }
        operations.push({
          kind: "renameInvariant",
          entityId: currentEntity.id,
          invariantId: currentInvariant.id,
          table: currentEntity.naming.sqlTable,
          from: previousInvariant.naming.sqlConstraint,
          to: currentInvariant.naming.sqlConstraint,
        });
      }
    }

    requireSameIds(previousEntity.temporalExclusions, currentEntity.temporalExclusions, `Exclusion in entity '${currentEntity.name}'`, current);
    const previousExclusions = byId(previousEntity.temporalExclusions);
    for (const currentExclusion of currentEntity.temporalExclusions) {
      const previousExclusion = previousExclusions.get(currentExclusion.id)!;
      if (!same(exclusionStructure(previousExclusion), exclusionStructure(currentExclusion))) {
        fail(current, "E2807", `Exclusion semantics changed for '${currentEntity.name}.${currentExclusion.name}'; only its name may change in 0.9.`);
      }
      if (previousExclusion.naming.sqlExclusionConstraint !== currentExclusion.naming.sqlExclusionConstraint) {
        const ignored = new Set([
          previousExclusion.naming.sqlExclusionConstraint,
          previousExclusion.naming.sqlValidIntervalConstraint,
        ]);
        if (constraintTargetCollides(previousEntity, ignored, currentExclusion.naming.sqlExclusionConstraint)
          || constraintTargetCollides(previousEntity, ignored, currentExclusion.naming.sqlValidIntervalConstraint)) {
          fail(current, "E2808", `Constraint rename target for '${currentEntity.name}.${currentExclusion.name}' collides with an existing constraint.`);
        }
        operations.push({
          kind: "renameExclusion",
          entityId: currentEntity.id,
          exclusionId: currentExclusion.id,
          table: currentEntity.naming.sqlTable,
          from: previousExclusion.naming.sqlExclusionConstraint,
          to: currentExclusion.naming.sqlExclusionConstraint,
          validFrom: previousExclusion.naming.sqlValidIntervalConstraint,
          validTo: currentExclusion.naming.sqlValidIntervalConstraint,
        });
      }
    }
  }

  requireSameIds(previous.actions, current.actions, "Action", current);
  const previousActions = byId(previous.actions);
  for (const currentAction of current.actions) {
    const previousAction = previousActions.get(currentAction.id)!;
    if (!same(actionStructure(previousAction), actionStructure(currentAction))) {
      fail(current, "E2807", `Action semantics changed for '${currentAction.name}'; only its name may change in a 0.9 rename migration.`);
    }
    if (previousAction.naming.sqlFunction !== currentAction.naming.sqlFunction) {
      const previousOperations = [...previous.actions, ...previous.queries];
      if (collides(previousOperations, currentAction.id, (candidate) => candidate.naming.sqlFunction, currentAction.naming.sqlFunction)) {
        fail(current, "E2808", `Function rename target '${currentAction.naming.sqlFunction}' collides with an existing generated function.`);
      }
      operations.push({
        kind: "renameAction",
        actionId: currentAction.id,
        from: previousAction.naming.sqlFunction,
        to: currentAction.naming.sqlFunction,
        parameterTypes: callableSqlTypes(previousAction),
      });
    }
  }

  requireSameIds(previous.queries, current.queries, "Query", current);
  const previousQueries = byId(previous.queries);
  for (const currentQuery of current.queries) {
    const previousQuery = previousQueries.get(currentQuery.id)!;
    if (!same(queryStructure(previousQuery), queryStructure(currentQuery))) {
      fail(current, "E2807", `Query semantics changed for '${currentQuery.name}'; only its name may change in a 0.9 rename migration.`);
    }
    if (previousQuery.naming.sqlFunction !== currentQuery.naming.sqlFunction) {
      const previousOperations = [...previous.actions, ...previous.queries];
      if (collides(previousOperations, currentQuery.id, (candidate) => candidate.naming.sqlFunction, currentQuery.naming.sqlFunction)) {
        fail(current, "E2808", `Function rename target '${currentQuery.naming.sqlFunction}' collides with an existing generated function.`);
      }
      operations.push({
        kind: "renameQuery",
        queryId: currentQuery.id,
        from: previousQuery.naming.sqlFunction,
        to: currentQuery.naming.sqlFunction,
        parameterTypes: callableSqlTypes(previousQuery),
      });
    }
  }

  const schema = quoteIdent(current.model.naming.sqlSchema);
  const statements = operations.flatMap((operation): string[] => {
    switch (operation.kind) {
      case "renameEntity":
        return [`ALTER TABLE ${schema}.${quoteIdent(operation.from)} RENAME TO ${quoteIdent(operation.to)};`];
      case "renameField":
        return [`ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME COLUMN ${quoteIdent(operation.from)} TO ${quoteIdent(operation.to)};`];
      case "renameEnum":
        return [`-- Semantic enum rename ${operation.from} -> ${operation.to}; stored values are unchanged.`];
      case "renameInvariant":
        return [`ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME CONSTRAINT ${quoteIdent(operation.from)} TO ${quoteIdent(operation.to)};`];
      case "renameExclusion":
        return [
          `ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME CONSTRAINT ${quoteIdent(operation.validFrom)} TO ${quoteIdent(operation.validTo)};`,
          `ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME CONSTRAINT ${quoteIdent(operation.from)} TO ${quoteIdent(operation.to)};`,
        ];
      case "renameAction":
      case "renameQuery":
        return [`ALTER FUNCTION ${schema}.${quoteIdent(operation.from)}(${operation.parameterTypes.join(", ")}) RENAME TO ${quoteIdent(operation.to)};`];
    }
  });
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
