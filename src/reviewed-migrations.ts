import { createHash } from "node:crypto";
import { ModelError, internalSpan } from "./diagnostics.js";
import type { IREntity, IREnum, IRField, ModelIR } from "./ir.js";
import {
  generateEntityForeignKeyStatements,
  generateEntityTableStatement,
  generateGatewayInfrastructureStatements,
  generateDecisionEvidenceInfrastructureStatements,
  generateCommandReceiptInfrastructureStatements,
  generateEventOutboxInfrastructureStatements,
  generateEventInboxInfrastructureStatements,
  generateConsumerRoleStatements,
  generateDispatcherRoleStatements,
  generateGatewayRoleStatements,
  generatePostgres,
  generateWorkflowStatements,
} from "./codegen/postgres.js";
import {
  historyBootstrapStatements,
  requireExplicitIds,
  requireUniquePhysicalTargets,
  sqlText,
} from "./migrations.js";
import { quoteIdent } from "./naming.js";
import { semanticDiff, type SemanticChange, type SemanticDiff } from "./semantic-diff.js";
import { decisionFunctionName } from "./decision-plan.js";

export const REVIEWED_MIGRATION_SCHEMA = "https://modellang.dev/schemas/reviewed-migration-plan.schema.json" as const;

export type ReviewDisposition = "accepted" | "dataLossAccepted" | "transformed";

export type ReviewedFieldValue =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "enumMember"; memberId: string }
  | { kind: "copyField"; sourceFieldId: string };

export interface ReviewedMigrationPlanDocument {
  $schema: typeof REVIEWED_MIGRATION_SCHEMA;
  planVersion: 1;
  strategy: "transactionalRebuild";
  description: string;
  from: { modelId: string; version: string; sourceHash: string };
  to: { modelId: string; version: string; sourceHash: string };
  acknowledgements: {
    changeKind: string;
    subjectId: string;
    disposition: ReviewDisposition;
    reason: string;
  }[];
  fieldValues: { targetFieldId: string; source: ReviewedFieldValue }[];
  enumMappings: {
    enumId: string;
    members: { fromMemberId: string; toMemberId: string }[];
  }[];
}

export interface ReviewedMigrationPlan {
  previousVersion: string;
  currentVersion: string;
  planHash: string;
  semanticDiff: SemanticDiff;
  sql: string;
}

function fail(ir: ModelIR, code: string, message: string): never {
  throw new ModelError(code, message, internalSpan(), ir.model.sourceFile);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reviewedMigrationPlanHash(plan: ReviewedMigrationPlanDocument): string {
  const normalized: ReviewedMigrationPlanDocument = {
    ...plan,
    acknowledgements: [...plan.acknowledgements].sort((left, right) =>
      `${left.changeKind}\0${left.subjectId}`.localeCompare(`${right.changeKind}\0${right.subjectId}`)),
    fieldValues: [...plan.fieldValues].sort((left, right) => left.targetFieldId.localeCompare(right.targetFieldId)),
    enumMappings: plan.enumMappings.map((mapping) => ({
      ...mapping,
      members: [...mapping.members].sort((left, right) => left.fromMemberId.localeCompare(right.fromMemberId)),
    })).sort((left, right) => left.enumId.localeCompare(right.enumId)),
  };
  return `sha256:${createHash("sha256").update(canonical(normalized)).digest("hex")}`;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], path: string): void {
  const expected = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length || missing.length) {
    throw new Error(`${path} has ${unexpected.length ? `unexpected key(s): ${unexpected.join(", ")}` : `missing key(s): ${missing.join(", ")}`}`);
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function reference(value: unknown, path: string): ReviewedMigrationPlanDocument["from"] {
  const result = object(value, path);
  exact(result, ["modelId", "version", "sourceHash"], path);
  return {
    modelId: string(result.modelId, `${path}.modelId`),
    version: string(result.version, `${path}.version`),
    sourceHash: string(result.sourceHash, `${path}.sourceHash`),
  };
}

export function parseReviewedMigrationPlan(value: unknown): ReviewedMigrationPlanDocument {
  const plan = object(value, "plan");
  exact(plan, ["$schema", "planVersion", "strategy", "description", "from", "to", "acknowledgements", "fieldValues", "enumMappings"], "plan");
  if (plan.$schema !== REVIEWED_MIGRATION_SCHEMA) throw new Error(`plan.$schema must be ${REVIEWED_MIGRATION_SCHEMA}`);
  if (plan.planVersion !== 1) throw new Error("plan.planVersion must be 1");
  if (plan.strategy !== "transactionalRebuild") throw new Error("plan.strategy must be transactionalRebuild");
  if (!Array.isArray(plan.acknowledgements) || !Array.isArray(plan.fieldValues) || !Array.isArray(plan.enumMappings)) {
    throw new Error("plan acknowledgements, fieldValues, and enumMappings must be arrays");
  }
  const acknowledgements = plan.acknowledgements.map((raw, index) => {
    const item = object(raw, `plan.acknowledgements[${index}]`);
    exact(item, ["changeKind", "subjectId", "disposition", "reason"], `plan.acknowledgements[${index}]`);
    if (!(["accepted", "dataLossAccepted", "transformed"] as unknown[]).includes(item.disposition)) {
      throw new Error(`plan.acknowledgements[${index}].disposition is invalid`);
    }
    return {
      changeKind: string(item.changeKind, `plan.acknowledgements[${index}].changeKind`),
      subjectId: string(item.subjectId, `plan.acknowledgements[${index}].subjectId`),
      disposition: item.disposition as ReviewDisposition,
      reason: string(item.reason, `plan.acknowledgements[${index}].reason`),
    };
  });
  const fieldValues = plan.fieldValues.map((raw, index) => {
    const item = object(raw, `plan.fieldValues[${index}]`);
    exact(item, ["targetFieldId", "source"], `plan.fieldValues[${index}]`);
    const source = object(item.source, `plan.fieldValues[${index}].source`);
    const kind = source.kind;
    if (kind === "literal") {
      exact(source, ["kind", "value"], `plan.fieldValues[${index}].source`);
      if (source.value !== null && !["string", "number", "boolean"].includes(typeof source.value)) {
        throw new Error(`plan.fieldValues[${index}].source.value must be a JSON scalar or null`);
      }
    } else if (kind === "enumMember") {
      exact(source, ["kind", "memberId"], `plan.fieldValues[${index}].source`);
      string(source.memberId, `plan.fieldValues[${index}].source.memberId`);
    } else if (kind === "copyField") {
      exact(source, ["kind", "sourceFieldId"], `plan.fieldValues[${index}].source`);
      string(source.sourceFieldId, `plan.fieldValues[${index}].source.sourceFieldId`);
    } else {
      throw new Error(`plan.fieldValues[${index}].source.kind is invalid`);
    }
    return { targetFieldId: string(item.targetFieldId, `plan.fieldValues[${index}].targetFieldId`), source: source as ReviewedFieldValue };
  });
  const enumMappings = plan.enumMappings.map((raw, index) => {
    const item = object(raw, `plan.enumMappings[${index}]`);
    exact(item, ["enumId", "members"], `plan.enumMappings[${index}]`);
    if (!Array.isArray(item.members)) throw new Error(`plan.enumMappings[${index}].members must be an array`);
    return {
      enumId: string(item.enumId, `plan.enumMappings[${index}].enumId`),
      members: item.members.map((rawMember, memberIndex) => {
        const member = object(rawMember, `plan.enumMappings[${index}].members[${memberIndex}]`);
        exact(member, ["fromMemberId", "toMemberId"], `plan.enumMappings[${index}].members[${memberIndex}]`);
        return {
          fromMemberId: string(member.fromMemberId, `plan.enumMappings[${index}].members[${memberIndex}].fromMemberId`),
          toMemberId: string(member.toMemberId, `plan.enumMappings[${index}].members[${memberIndex}].toMemberId`),
        };
      }),
    };
  });
  return {
    $schema: REVIEWED_MIGRATION_SCHEMA,
    planVersion: 1,
    strategy: "transactionalRebuild",
    description: string(plan.description, "plan.description"),
    from: reference(plan.from, "plan.from"),
    to: reference(plan.to, "plan.to"),
    acknowledgements,
    fieldValues,
    enumMappings,
  };
}

function byId<T extends { id: string }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]));
}

function requireReference(ir: ModelIR, label: string, actual: ModelIR, reference: ReviewedMigrationPlanDocument["from"]): void {
  if (reference.modelId !== actual.model.id || reference.version !== actual.model.version || reference.sourceHash !== actual.model.sourceHash) {
    fail(ir, "E2902", `Reviewed plan ${label} reference does not match ${actual.model.version} (${actual.model.sourceHash}).`);
  }
}

function changeKey(change: Pick<SemanticChange, "kind" | "subject">): string {
  return `${change.kind}\0${change.subject.id}`;
}

function validateCoverage(ir: ModelIR, report: SemanticDiff, plan: ReviewedMigrationPlanDocument): void {
  const needed = report.changes.filter((change) => change.classification !== "additive");
  const actual = new Map<string, ReviewedMigrationPlanDocument["acknowledgements"][number]>();
  for (const acknowledgement of plan.acknowledgements) {
    const key = `${acknowledgement.changeKind}\0${acknowledgement.subjectId}`;
    if (actual.has(key)) fail(ir, "E2903", `Reviewed plan contains duplicate acknowledgement for ${acknowledgement.changeKind} ${acknowledgement.subjectId}.`);
    actual.set(key, acknowledgement);
  }
  for (const change of needed) {
    const acknowledgement = actual.get(changeKey(change));
    if (!acknowledgement) fail(ir, "E2904", `Reviewed plan must acknowledge ${change.kind} for ${change.subject.kind} '${change.subject.name}' (${change.subject.id}).`);
    if (change.kind === "declarationRemoved" && change.persistenceRisk
      && acknowledgement.disposition !== "dataLossAccepted" && acknowledgement.disposition !== "transformed") {
      fail(ir, "E2905", `Removal of ${change.subject.kind} '${change.subject.name}' requires dataLossAccepted or transformed disposition.`);
    }
  }
  for (const [key, acknowledgement] of actual) {
    if (!needed.some((change) => changeKey(change) === key)) {
      fail(ir, "E2906", `Acknowledgement ${acknowledgement.changeKind} ${acknowledgement.subjectId} does not cover a review-required semantic change.`);
    }
  }
}

function sqlType(type: string): string {
  if (type.startsWith("entity:")) return "uuid";
  if (type.startsWith("set:enum:")) return "text[]";
  if (type.startsWith("enum:")) return "text";
  if (type.startsWith("Money<")) return "numeric";
  const types: Record<string, string> = { String: "text", Int: "bigint", Decimal: "numeric", Boolean: "boolean", UUID: "uuid", DateTime: "timestamptz" };
  const result = types[type];
  if (!result) throw new Error(`Unsupported reviewed-migration type ${type}`);
  return result;
}

function qname(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function callableSignature(operation: ModelIR["actions"][number] | ModelIR["queries"][number]): string {
  return operation.callableParameters
    .map((id) => sqlType(operation.parameters.find((parameter) => parameter.id === id)!.type))
    .join(", ");
}

function enumById(ir: ModelIR, id: string): IREnum {
  const result = ir.enums.find((value) => value.id === id);
  if (!result) fail(ir, "E2910", `Reviewed plan references unknown enum '${id}'.`);
  return result;
}

function enumExpression(
  ir: ModelIR,
  previous: ModelIR,
  current: ModelIR,
  sourceField: IRField,
  targetField: IRField,
  sourceSql: string,
  mappings: Map<string, Map<string, string>>,
): string {
  if (sourceField.type !== targetField.type || !sourceField.type.startsWith("enum:")) {
    fail(ir, "E2911", `copyField requires identical types; '${sourceField.name}' is ${sourceField.type} and '${targetField.name}' is ${targetField.type}.`);
  }
  const previousEnum = enumById(previous, sourceField.type);
  const currentEnum = enumById(current, targetField.type);
  const currentMembers = byId(currentEnum.members);
  const explicit = mappings.get(previousEnum.id) ?? new Map<string, string>();
  const pairs = previousEnum.members.map((member) => {
    const targetId = currentMembers.has(member.id) ? member.id : explicit.get(member.id);
    if (!targetId) fail(ir, "E2912", `Enum member '${previousEnum.name}.${member.name}' needs an explicit enum mapping.`);
    const target = currentMembers.get(targetId);
    if (!target) fail(ir, "E2913", `Enum mapping target '${targetId}' is not a member of '${currentEnum.name}'.`);
    return [member.naming.sqlValue, target.naming.sqlValue] as const;
  });
  if (pairs.every(([from, to]) => from === to)) return sourceSql;
  return `(CASE ${sourceSql} ${pairs.map(([from, to]) => `WHEN ${sqlText(from)} THEN ${sqlText(to)}`).join(" ")} END)`;
}

function copyExpression(
  ir: ModelIR,
  previous: ModelIR,
  current: ModelIR,
  sourceField: IRField,
  targetField: IRField,
  sourceAlias: string,
  mappings: Map<string, Map<string, string>>,
): string {
  const sourceSql = `${sourceAlias}.${quoteIdent(sourceField.naming.sqlColumn)}`;
  if (sourceField.type !== targetField.type) {
    fail(ir, "E2911", `Reviewed migration v1 does not transform field types (${sourceField.name}: ${sourceField.type} -> ${targetField.name}: ${targetField.type}).`);
  }
  if (sourceField.type.startsWith("enum:")) return enumExpression(ir, previous, current, sourceField, targetField, sourceSql, mappings);
  if (sourceField.type.startsWith("set:enum:")) {
    const enumId = sourceField.type.slice(4);
    const oldValues = enumById(previous, enumId).members.map((member) => `${member.id}:${member.naming.sqlValue}`);
    const newValues = enumById(current, enumId).members.map((member) => `${member.id}:${member.naming.sqlValue}`);
    if (!oldValues.every((value) => newValues.includes(value))) {
      fail(ir, "E2914", `Reviewed migration v1 cannot transform enum-set field '${targetField.name}'.`);
    }
  }
  return sourceSql;
}

function literalExpression(ir: ModelIR, field: IRField, value: string | number | boolean | null): string {
  const cast = sqlType(field.type);
  if (value === null) {
    if (!field.optional) fail(ir, "E2915", `Backfill for required field '${field.name}' cannot be null.`);
    return `NULL::${cast}`;
  }
  if (field.type === "String") {
    if (typeof value !== "string") fail(ir, "E2915", `Backfill for String field '${field.name}' must be a string.`);
  } else if (field.type === "Boolean") {
    if (typeof value !== "boolean") fail(ir, "E2915", `Backfill for Boolean field '${field.name}' must be a boolean.`);
  } else if (field.type === "Int") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(ir, "E2915", `Backfill for Int field '${field.name}' must be a safe integer.`);
  } else if (field.type === "Decimal" || field.type.startsWith("Money<")) {
    if ((typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
      && (typeof value !== "number" || !Number.isFinite(value))) {
      fail(ir, "E2915", `Backfill for numeric field '${field.name}' must be a finite JSON number or canonical decimal string.`);
    }
  } else if (field.type === "UUID" || field.type === "DateTime" || field.type.startsWith("entity:")) {
    if (typeof value !== "string") fail(ir, "E2915", `Backfill for '${field.name}' must be a string.`);
  } else {
    fail(ir, "E2915", `Field '${field.name}' requires enumMember or uses an unsupported literal type.`);
  }
  const encoded = typeof value === "string" ? sqlText(value) : typeof value === "boolean" ? String(value).toUpperCase() : String(value);
  return `${encoded}::${cast}`;
}

function valueExpression(
  ir: ModelIR,
  previous: ModelIR,
  current: ModelIR,
  previousEntity: IREntity,
  targetField: IRField,
  value: ReviewedFieldValue,
  sourceAlias: string,
  mappings: Map<string, Map<string, string>>,
): string {
  if (value.kind === "literal") return literalExpression(ir, targetField, value.value);
  if (value.kind === "enumMember") {
    if (!targetField.type.startsWith("enum:")) fail(ir, "E2915", `enumMember backfill can only target an enum field ('${targetField.name}').`);
    const enumeration = enumById(current, targetField.type);
    const member = enumeration.members.find((candidate) => candidate.id === value.memberId);
    if (!member) fail(ir, "E2913", `Backfill member '${value.memberId}' is not in enum '${enumeration.name}'.`);
    return `${sqlText(member.naming.sqlValue)}::text`;
  }
  const sourceField = previousEntity.fields.find((field) => field.id === value.sourceFieldId);
  if (!sourceField) fail(ir, "E2916", `copyField source '${value.sourceFieldId}' is not in previous entity '${previousEntity.name}'.`);
  return copyExpression(ir, previous, current, sourceField, targetField, sourceAlias, mappings);
}

function stagingIR(current: ModelIR, stageSchema: string): ModelIR {
  return { ...current, model: { ...current.model, naming: { ...current.model.naming, sqlSchema: stageSchema } } };
}

export function planReviewedMigration(
  previous: ModelIR,
  current: ModelIR,
  input: ReviewedMigrationPlanDocument | unknown,
): ReviewedMigrationPlan {
  const plan = parseReviewedMigrationPlan(input);
  if (![9, 10, 11, 12, 13, 14].includes(Number(previous.irVersion)) || current.irVersion !== 14) fail(current, "E2901", "Reviewed migration planning requires a canonical IR9/IR10/IR11/IR12/IR13/IR14 baseline and canonical IR14 current input.");
  requireExplicitIds(previous);
  requireExplicitIds(current);
  requireUniquePhysicalTargets(current);
  if (previous.model.id !== current.model.id || previous.model.name !== current.model.name
    || previous.model.naming.sqlSchema !== current.model.naming.sqlSchema
    || previous.model.naming.internalSchema !== current.model.naming.internalSchema) {
    fail(current, "E2901", "Reviewed migration v1 requires unchanged model identity, name, and PostgreSQL schemas.");
  }
  if (previous.principal.entityId !== current.principal.entityId) fail(current, "E2901", "Reviewed migration v1 cannot replace the principal entity.");
  if (previous.model.version === current.model.version) fail(current, "E2901", "Reviewed migration requires a new model version.");
  requireReference(current, "from", previous, plan.from);
  requireReference(current, "to", current, plan.to);
  const report = semanticDiff(previous, current);
  validateCoverage(current, report, plan);

  const planHash = reviewedMigrationPlanHash(plan);
  const fieldValues = new Map<string, ReviewedFieldValue>();
  for (const entry of plan.fieldValues) {
    if (fieldValues.has(entry.targetFieldId)) fail(current, "E2907", `Duplicate field value for '${entry.targetFieldId}'.`);
    fieldValues.set(entry.targetFieldId, entry.source);
  }
  const enumMappings = new Map<string, Map<string, string>>();
  for (const mapping of plan.enumMappings) {
    if (enumMappings.has(mapping.enumId)) fail(current, "E2908", `Duplicate enum mapping for '${mapping.enumId}'.`);
    const previousEnum = enumById(previous, mapping.enumId);
    const currentEnum = enumById(current, mapping.enumId);
    const members = new Map<string, string>();
    for (const member of mapping.members) {
      if (!previousEnum.members.some((candidate) => candidate.id === member.fromMemberId)) fail(current, "E2913", `Unknown enum mapping source '${member.fromMemberId}'.`);
      if (!currentEnum.members.some((candidate) => candidate.id === member.toMemberId)) fail(current, "E2913", `Unknown enum mapping target '${member.toMemberId}'.`);
      if (currentEnum.members.some((candidate) => candidate.id === member.fromMemberId)) {
        fail(current, "E2913", `Enum mapping source '${member.fromMemberId}' is retained by stable ID and cannot be remapped.`);
      }
      if (members.has(member.fromMemberId)) fail(current, "E2908", `Duplicate mapping for enum member '${member.fromMemberId}'.`);
      members.set(member.fromMemberId, member.toMemberId);
    }
    enumMappings.set(mapping.enumId, members);
  }

  for (const change of report.changes.filter((candidate) => candidate.kind === "declarationRemoved")) {
    const acknowledgement = plan.acknowledgements.find((candidate) =>
      candidate.changeKind === change.kind && candidate.subjectId === change.subject.id)!;
    if (acknowledgement.disposition !== "transformed") continue;
    if (change.subject.kind === "enumMember") {
      const owner = previous.enums.find((enumeration) => enumeration.members.some((member) => member.id === change.subject.id));
      if (!owner || !enumMappings.get(owner.id)?.has(change.subject.id)) {
        fail(current, "E2918", `Transformed enum member '${change.subject.name}' needs an explicit stable-ID mapping.`);
      }
    } else if (change.subject.kind === "field") {
      if (!plan.fieldValues.some((entry) => entry.source.kind === "copyField" && entry.source.sourceFieldId === change.subject.id)) {
        fail(current, "E2918", `Transformed field '${change.subject.name}' must be the source of an explicit copyField value.`);
      }
    } else {
      fail(current, "E2918", `Reviewed migration v1 cannot transform removed ${change.subject.kind} '${change.subject.name}'; use dataLossAccepted if removal is intended.`);
    }
  }

  const previousEntities = byId(previous.entities);
  const currentFields = new Set(current.entities.flatMap((entity) => entity.fields.map((field) => field.id)));
  for (const target of fieldValues.keys()) if (!currentFields.has(target)) fail(current, "E2909", `Field value targets unknown current field '${target}'.`);

  const stageSuffix = `_ml16_${planHash.slice(7, 19)}`;
  const stageSchema = `${current.model.naming.sqlSchema.slice(0, 63 - stageSuffix.length)}${stageSuffix}`;
  const staged = stagingIR(current, stageSchema);
  const copyStatements: string[] = [];
  const usedValues = new Set<string>();
  for (const entity of current.entities) {
    const oldEntity = previousEntities.get(entity.id);
    if (!oldEntity) continue;
    const oldFields = byId(oldEntity.fields);
    const targetColumns: string[] = [];
    const expressions: string[] = [];
    for (const field of entity.fields) {
      const explicit = fieldValues.get(field.id);
      const oldField = oldFields.get(field.id);
      if (explicit) {
        usedValues.add(field.id);
        targetColumns.push(quoteIdent(field.naming.sqlColumn));
        expressions.push(valueExpression(current, previous, current, oldEntity, field, explicit, "source", enumMappings));
      } else if (oldField) {
        targetColumns.push(quoteIdent(field.naming.sqlColumn));
        expressions.push(copyExpression(current, previous, current, oldField, field, "source", enumMappings));
      } else if (!field.optional && !field.default && !field.generation) {
        fail(current, "E2917", `Required field '${entity.name}.${field.name}' needs a reviewed field value.`);
      }
    }
    copyStatements.push(
      `INSERT INTO ${qname(stageSchema, entity.naming.sqlTable)} (${targetColumns.join(", ")})`,
      `SELECT ${expressions.join(", ")} FROM ${qname(previous.model.naming.sqlSchema, oldEntity.naming.sqlTable)} AS source;`,
      `DO $modellang_reviewed$`,
      "BEGIN",
      `  IF (SELECT pg_catalog.count(*) FROM ${qname(stageSchema, entity.naming.sqlTable)}) <> (SELECT pg_catalog.count(*) FROM ${qname(previous.model.naming.sqlSchema, oldEntity.naming.sqlTable)}) THEN`,
      `    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_ROW_COUNT:${entity.id.replaceAll("'", "''")}';`,
      "  END IF;",
      "END",
      "$modellang_reviewed$;",
    );
  }
  for (const target of fieldValues.keys()) if (!usedValues.has(target)) fail(current, "E2909", `Field value for '${target}' is unused; values only apply to entities that already contain rows.`);

  const generated = generatePostgres(current);
  const schema = current.model.naming.sqlSchema;
  const internal = current.model.naming.internalSchema;
  const principal = current.entities.find((entity) => entity.id === current.principal.entityId)!;
  const lockTargets = previous.entities.map((entity) => qname(schema, entity.naming.sqlTable)).sort();
  const sql = [
    `-- ModelLang reviewed schema migration ${previous.model.version} -> ${current.model.version}`,
    `-- plan ${planHash}`,
    "-- This offline migration validates copied data in a staging schema before replacement.",
    "BEGIN;",
    generateGatewayRoleStatements(),
    generateDispatcherRoleStatements(),
    generateConsumerRoleStatements(),
    "SET LOCAL ROLE modellang_owner;",
    ...historyBootstrapStatements(previous, current),
    ...(lockTargets.length ? [`LOCK TABLE ${lockTargets.join(", ")} IN ACCESS EXCLUSIVE MODE;`] : []),
    "RESET ROLE;",
    ...(current.entities.some((entity) => entity.temporalExclusions.length > 0) ? ["CREATE EXTENSION IF NOT EXISTS btree_gist;"] : []),
    `CREATE SCHEMA ${quoteIdent(stageSchema)};`,
    `GRANT USAGE, CREATE ON SCHEMA ${quoteIdent(stageSchema)} TO modellang_owner;`,
    "SET LOCAL ROLE modellang_owner;",
    `REVOKE ALL ON SCHEMA ${quoteIdent(stageSchema)} FROM PUBLIC;`,
    ...current.entities.map((entity) => generateEntityTableStatement(staged, entity)),
    ...copyStatements,
    ...current.entities.flatMap((entity) => generateEntityForeignKeyStatements(staged, entity)),
    `ALTER TABLE ${qname(internal, "principal_binding")} DROP CONSTRAINT IF EXISTS ${quoteIdent("principal_binding_principal_id_fkey")};`,
    `ALTER TABLE ${qname(internal, "gateway_principal_binding")} DROP CONSTRAINT IF EXISTS ${quoteIdent("gateway_principal_binding_principal_id_fkey")};`,
    ...[...previous.actions, ...previous.queries].map((operation) =>
      `DROP FUNCTION ${qname(schema, operation.naming.sqlFunction)}(${callableSignature(operation)});`),
    ...previous.actions.map((action) =>
      `DROP FUNCTION IF EXISTS ${qname(schema, decisionFunctionName(action.id))}(${[...action.callableParameters.map((id) => sqlType(action.parameters.find((parameter) => parameter.id === id)!.type)), "text"].join(", ")});`),
    ...((previous as ModelIR & { consumers?: ModelIR["consumers"] }).consumers ?? []).map((consumer) =>
      `DROP FUNCTION IF EXISTS ${qname(internal, consumer.naming.sqlFunction)}(jsonb);`),
    `DROP TABLE ${previous.entities.map((entity) => qname(schema, entity.naming.sqlTable)).join(", ")};`,
    ...previous.workflows.map((workflow) => `DROP FUNCTION ${qname(internal, workflow.naming.sqlTriggerFunction)}();`),
    "RESET ROLE;",
    `DROP SCHEMA ${quoteIdent(schema)};`,
    `ALTER SCHEMA ${quoteIdent(stageSchema)} RENAME TO ${quoteIdent(schema)};`,
    `ALTER SCHEMA ${quoteIdent(schema)} OWNER TO modellang_owner;`,
    "SET LOCAL ROLE modellang_owner;",
    `ALTER TABLE ${qname(internal, "principal_binding")} ADD CONSTRAINT ${quoteIdent("principal_binding_principal_id_fkey")} FOREIGN KEY (${quoteIdent("principal_id")}) REFERENCES ${qname(schema, principal.naming.sqlTable)} (${quoteIdent("id")});`,
    `ALTER TABLE ${qname(internal, "gateway_principal_binding")} ADD CONSTRAINT ${quoteIdent("gateway_principal_binding_principal_id_fkey")} FOREIGN KEY (${quoteIdent("principal_id")}) REFERENCES ${qname(schema, principal.naming.sqlTable)} (${quoteIdent("id")});`,
    ...current.workflows.flatMap((workflow) => generateWorkflowStatements(current, workflow, true)),
    ...generateGatewayInfrastructureStatements(current),
    ...generateDecisionEvidenceInfrastructureStatements(current),
    ...generateCommandReceiptInfrastructureStatements(current),
    ...generateEventOutboxInfrastructureStatements(current),
    ...generateEventInboxInfrastructureStatements(current),
    generated["003_actions.sql"]!.trim(),
    generated["003_consumers.sql"]!.trim(),
    generated["003_decisions.sql"]!.trim(),
    generated["003_queries.sql"]!.trim(),
    generated["004_grants.sql"]!.trim(),
    "SET LOCAL ROLE modellang_owner;",
    `INSERT INTO ${qname(internal, "schema_migrations")} (${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}, ${quoteIdent("migration_kind")}, ${quoteIdent("plan_hash")})`,
    `VALUES (${sqlText(current.model.id)}, ${sqlText(current.model.version)}, ${sqlText(current.model.sourceHash)}, 'reviewed', ${sqlText(planHash)});`,
    "COMMIT;",
    "",
  ].join("\n");
  return { previousVersion: previous.model.version, currentVersion: current.model.version, planHash, semanticDiff: report, sql };
}
