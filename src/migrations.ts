import { ModelError, internalSpan } from "./diagnostics.js";
import type {
  IRAction, IRConsumer, IREntity, IREnum, IREnumMember, IRField, IRInvariant, IRQuery,
  IRPolicy, IRTemporalExclusion, IRWorkflow, IRWorkflowTransition, ModelIR,
} from "./ir.js";
import {
  generateAddFieldStatements,
  generateEntityForeignKeyStatements,
  generateEntityTableStatement,
  generateDecisionEvidenceInfrastructureStatements,
  generateCommandReceiptInfrastructureStatements,
  generateEventOutboxInfrastructureStatements,
  generateEventInboxInfrastructureStatements,
  generateConsumerRoleStatements,
  generateDispatcherRoleStatements,
  generateGatewayInfrastructureStatements,
  generateGatewayRoleStatements,
  generatePostgres,
  generateRefreshEnumConstraintStatements,
  generateWorkflowStatements,
} from "./codegen/postgres.js";
import { isMoneyType } from "./money.js";
import { quoteIdent, snakeCase } from "./naming.js";

export type RenameOperation =
  | { kind: "renameEntity"; entityId: string; from: string; to: string }
  | { kind: "renameField"; entityId: string; fieldId: string; table: string; from: string; to: string }
  | { kind: "renameEnum"; enumId: string; from: string; to: string }
  | { kind: "renamePolicy"; policyId: string; from: string; to: string }
  | { kind: "renamePolicyBranch"; policyId: string; branchId: string; from: string; to: string }
  | { kind: "renameInvariant"; entityId: string; invariantId: string; table: string; from: string; to: string }
  | { kind: "renameExclusion"; entityId: string; exclusionId: string; table: string; from: string; to: string; validFrom: string; validTo: string }
  | { kind: "renameAction"; actionId: string; from: string; to: string; parameterTypes: string[] }
  | { kind: "renameQuery"; queryId: string; from: string; to: string; parameterTypes: string[] };

export type AdditiveOperation =
  | { kind: "addEnum"; enumId: string; name: string }
  | { kind: "addEnumMember"; enumId: string; memberId: string; name: string }
  | { kind: "addEntity"; entityId: string; name: string; table: string }
  | { kind: "addPolicy"; policyId: string; name: string }
  | { kind: "addEvent"; eventId: string; name: string }
  | { kind: "addField"; entityId: string; fieldId: string; name: string; table: string; column: string }
  | { kind: "addAction"; actionId: string; name: string }
  | { kind: "addConsumer"; consumerId: string; name: string }
  | { kind: "addQuery"; queryId: string; name: string }
  | { kind: "addWorkflow"; workflowId: string; name: string }
  | { kind: "addTransition"; workflowId: string; transitionId: string; name: string };

export type MigrationOperation = RenameOperation | AdditiveOperation;

export interface MigrationPlan {
  previousVersion: string;
  currentVersion: string;
  operations: MigrationOperation[];
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

export function requireExplicitIds(ir: ModelIR): void {
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
  for (const consumer of (ir as ModelIR & { consumers?: IRConsumer[] }).consumers ?? []) requireExplicit(ir, consumer, "consumer", "consumer");
  for (const event of (ir as ModelIR & { events?: ModelIR["events"] }).events ?? []) requireExplicit(ir, event, "event", "event");
  for (const policy of (ir as ModelIR & { policies?: IRPolicy[] }).policies ?? []) {
    requireExplicit(ir, policy, "policy", "policy");
    for (const branch of policy.branches) requireExplicit(ir, branch, `branch in policy '${policy.name}'`, "policyBranch");
  }
  for (const query of ir.queries) requireExplicit(ir, query, "query", "query");
  for (const workflow of ir.workflows) {
    requireExplicit(ir, workflow, "workflow", "workflow");
    for (const transition of workflow.transitions) {
      requireExplicit(ir, transition, `transition in '${workflow.name}'`, "transition");
    }
  }
}

function additiveDiff<T extends { id: string; name: string }>(
  previous: T[],
  current: T[],
  subject: string,
  ir: ModelIR,
): { added: T[]; existing: T[] } {
  const previousIds = new Set(previous.map((value) => value.id));
  const currentIds = new Set(current.map((value) => value.id));
  const removed = previous.filter((value) => !currentIds.has(value.id));
  if (removed.length) {
    fail(ir, "E2805", `${subject} removal or changed stable ID is unsafe in 0.10 (removed: ${removed.map((value) => value.name).join(", ")}).`);
  }
  return {
    added: current.filter((value) => !previousIds.has(value.id)),
    existing: current.filter((value) => previousIds.has(value.id)),
  };
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
  const { name: _name, identity: _identity, emittedEventIds, ...structure } = action;
  return { ...structure, emittedEventIds: emittedEventIds ?? [] };
}

function consumerStructure(consumer: IRConsumer): unknown {
  const { name: _name, identity: _identity, ...structure } = consumer;
  return structure;
}

function policyStructure(policy: IRPolicy): unknown {
  const { name: _name, identity: _identity, branches: _branches, ...structure } = policy;
  return structure;
}

function policyBranchStructure(branch: IRPolicy["branches"][number]): unknown {
  const { name: _name, identity: _identity, ...structure } = branch;
  return structure;
}

function queryStructure(query: IRQuery): unknown {
  const { name: _name, identity: _identity, ...structure } = query;
  return structure;
}

function workflowStructure(workflow: IRWorkflow): unknown {
  const { identity: _identity, transitions: _transitions, ...structure } = workflow;
  return structure;
}

function transitionStructure(transition: IRWorkflowTransition): unknown {
  const { name: _name, identity: _identity, ...structure } = transition;
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

export function requireUniquePhysicalTargets(ir: ModelIR): void {
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

function requireSafeAddedField(ir: ModelIR, entity: IREntity, field: IRField): void {
  if (!field.optional && !field.default && !field.generation) {
    fail(ir, "E2811", `Required added field '${entity.name}.${field.name}' needs a constant default or database generation strategy.`);
  }
  if (field.annotations.some((annotation) => annotation.name === "unique")) {
    fail(ir, "E2812", `Adding @unique field '${entity.name}.${field.name}' to an existing entity requires a reviewed data migration.`);
  }
  if (field.default?.kind === "literal" || field.default?.kind === "moneyLiteral") {
    const value = field.default.kind === "moneyLiteral"
      ? Number(field.default.amount)
      : typeof field.default.value === "number" ? field.default.value : undefined;
    if (value !== undefined) {
      for (const annotation of field.annotations) {
        const boundary = typeof annotation.value === "number" || typeof annotation.value === "string"
          ? Number(annotation.value)
          : undefined;
        if (boundary === undefined || !Number.isFinite(boundary)) continue;
        if ((annotation.name === "min" && value < boundary)
          || (annotation.name === "minExclusive" && value <= boundary)
          || (annotation.name === "max" && value > boundary)) {
          fail(ir, "E2813", `Default for added field '${entity.name}.${field.name}' violates @${annotation.name}(${annotation.value}).`);
        }
      }
    }
  }
}

export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function historyBootstrapStatements(previous: ModelIR, current: ModelIR): string[] {
  const internal = quoteIdent(current.model.naming.internalSchema);
  return [
    `CREATE TABLE IF NOT EXISTS ${internal}.${quoteIdent("schema_migrations")} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("model_id")} text NOT NULL,`,
    `  ${quoteIdent("version")} text NOT NULL UNIQUE,`,
    `  ${quoteIdent("source_hash")} text NOT NULL UNIQUE,`,
    `  ${quoteIdent("migration_kind")} text NOT NULL,`,
    `  ${quoteIdent("plan_hash")} text,`,
    `  CONSTRAINT ${quoteIdent("ck_schema_migrations_kind")} CHECK (${quoteIdent("migration_kind")} IN ('installation', 'safe', 'reviewed')),`,
    `  CONSTRAINT ${quoteIdent("ck_schema_migrations_reviewed_plan")} CHECK (((${quoteIdent("migration_kind")} = 'reviewed') = (${quoteIdent("plan_hash")} IS NOT NULL)) AND (${quoteIdent("plan_hash")} IS NULL OR ${quoteIdent("plan_hash")} ~ '^sha256:[0-9a-f]{64}$')),`,
    `  ${quoteIdent("applied_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()`,
    ");",
    `ALTER TABLE ${internal}.${quoteIdent("schema_migrations")} ADD COLUMN IF NOT EXISTS ${quoteIdent("migration_kind")} text;`,
    `ALTER TABLE ${internal}.${quoteIdent("schema_migrations")} ADD COLUMN IF NOT EXISTS ${quoteIdent("plan_hash")} text;`,
    `UPDATE ${internal}.${quoteIdent("schema_migrations")} SET ${quoteIdent("migration_kind")} = CASE`,
    `  WHEN ${quoteIdent("id")} = (SELECT pg_catalog.min(${quoteIdent("id")}) FROM ${internal}.${quoteIdent("schema_migrations")}) THEN 'installation'`,
    "  ELSE 'safe'",
    `END WHERE ${quoteIdent("migration_kind")} IS NULL;`,
    `ALTER TABLE ${internal}.${quoteIdent("schema_migrations")} ALTER COLUMN ${quoteIdent("migration_kind")} SET NOT NULL;`,
    "DO $modellang_history$",
    "BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '${internal}.${quoteIdent("schema_migrations")}'::regclass AND conname = 'ck_schema_migrations_kind') THEN`,
    `    ALTER TABLE ${internal}.${quoteIdent("schema_migrations")} ADD CONSTRAINT ${quoteIdent("ck_schema_migrations_kind")} CHECK (${quoteIdent("migration_kind")} IN ('installation', 'safe', 'reviewed'));`,
    "  END IF;",
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '${internal}.${quoteIdent("schema_migrations")}'::regclass AND conname = 'ck_schema_migrations_reviewed_plan') THEN`,
    `    ALTER TABLE ${internal}.${quoteIdent("schema_migrations")} ADD CONSTRAINT ${quoteIdent("ck_schema_migrations_reviewed_plan")} CHECK (((${quoteIdent("migration_kind")} = 'reviewed') = (${quoteIdent("plan_hash")} IS NOT NULL)) AND (${quoteIdent("plan_hash")} IS NULL OR ${quoteIdent("plan_hash")} ~ '^sha256:[0-9a-f]{64}$'));`,
    "  END IF;",
    "END",
    "$modellang_history$;",
    `INSERT INTO ${internal}.${quoteIdent("schema_migrations")} (${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}, ${quoteIdent("migration_kind")})`,
    `SELECT ${sqlText(previous.model.id)}, ${sqlText(previous.model.version)}, ${sqlText(previous.model.sourceHash)}, 'installation'`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${internal}.${quoteIdent("schema_migrations")});`,
    `DO $modellang_migration$`,
    "DECLARE",
    "  v_model_id text;",
    "  v_version text;",
    "  v_source_hash text;",
    "BEGIN",
    `  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}`,
    "  INTO v_model_id, v_version, v_source_hash",
    `  FROM ${internal}.${quoteIdent("schema_migrations")}`,
    `  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;`,
    `  IF v_model_id IS DISTINCT FROM ${sqlText(previous.model.id)}`,
    `     OR v_version IS DISTINCT FROM ${sqlText(previous.model.version)}`,
    `     OR v_source_hash IS DISTINCT FROM ${sqlText(previous.model.sourceHash)} THEN`,
    `    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${previous.model.sourceHash.replaceAll("'", "''")}';`,
    "  END IF;",
    "END",
    "$modellang_migration$;",
  ];
}

export function planMigration(previous: ModelIR, current: ModelIR): MigrationPlan {
  if (![9, 10, 11, 12, 13, 14].includes(Number(previous.irVersion)) || current.irVersion !== 14) {
    fail(current, "E2803", "Migration planning requires a canonical IR9/IR10/IR11/IR12/IR13/IR14 baseline and canonical IR14 current input.");
  }
  requireExplicitIds(previous);
  requireExplicitIds(current);
  if (previous.model.id !== current.model.id
    || previous.model.name !== current.model.name
    || previous.model.naming.sqlSchema !== current.model.naming.sqlSchema
    || previous.model.naming.internalSchema !== current.model.naming.internalSchema) {
    fail(current, "E2806", "Model identity, name, and schema must remain unchanged in a 0.10 safe migration.");
  }
  if (previous.principal.entityId !== current.principal.entityId) {
    fail(current, "E2807", "Principal semantics changed; principal replacement is unsafe in 0.10.");
  }
  requireUniquePhysicalTargets(current);

  const operations: MigrationOperation[] = [];
  const enumDiff = additiveDiff(previous.enums, current.enums, "Enum", current);
  for (const enumeration of enumDiff.added) {
    operations.push({ kind: "addEnum", enumId: enumeration.id, name: enumeration.name });
  }
  const previousEnums = byId(previous.enums);
  const expandedEnumIds = new Set<string>();
  for (const currentEnum of enumDiff.existing) {
    const previousEnum = previousEnums.get(currentEnum.id)!;
    if (!same(enumStructure(previousEnum), enumStructure(currentEnum))) {
      fail(current, "E2807", `Enum structure changed for '${currentEnum.name}'; only renames and member additions are safe in 0.10.`);
    }
    const memberDiff = additiveDiff(previousEnum.members, currentEnum.members, `Member in enum '${currentEnum.name}'`, current);
    if (memberDiff.added.length) expandedEnumIds.add(currentEnum.id);
    for (const member of memberDiff.added) {
      operations.push({ kind: "addEnumMember", enumId: currentEnum.id, memberId: member.id, name: member.name });
    }
    const previousMembers = byId(previousEnum.members);
    for (const currentMember of memberDiff.existing) {
      const previousMember = previousMembers.get(currentMember.id)!;
      if (previousMember.name !== currentMember.name) {
        fail(current, "E2807", `Enum member rename '${previousEnum.name}.${previousMember.name}' -> '${currentEnum.name}.${currentMember.name}' requires stored-value migration and is unsafe in 0.10.`);
      }
      if (!same(enumMemberStructure(previousMember), enumMemberStructure(currentMember))) {
        fail(current, "E2807", `Enum member structure changed for '${currentEnum.name}.${currentMember.name}'.`);
      }
    }
    if (previousEnum.name !== currentEnum.name) {
      operations.push({ kind: "renameEnum", enumId: currentEnum.id, from: previousEnum.name, to: currentEnum.name });
    }
  }

  const entityDiff = additiveDiff(previous.entities, current.entities, "Entity", current);
  for (const entity of entityDiff.added) {
    operations.push({ kind: "addEntity", entityId: entity.id, name: entity.name, table: entity.naming.sqlTable });
  }
  const previousEntities = byId(previous.entities);
  for (const currentEntity of entityDiff.existing) {
    const previousEntity = previousEntities.get(currentEntity.id)!;
    if (!same(entityStructure(previousEntity), entityStructure(currentEntity))) {
      fail(current, "E2807", `Entity structure changed for '${currentEntity.name}'; only renames and safe field additions are supported in 0.10.`);
    }
    const fields = additiveDiff(previousEntity.fields, currentEntity.fields, `Field in entity '${currentEntity.name}'`, current);
    for (const field of fields.added) {
      requireSafeAddedField(current, currentEntity, field);
      operations.push({
        kind: "addField",
        entityId: currentEntity.id,
        fieldId: field.id,
        name: field.name,
        table: currentEntity.naming.sqlTable,
        column: field.naming.sqlColumn,
      });
    }
    const previousFields = byId(previousEntity.fields);
    for (const currentField of fields.existing) {
      const previousField = previousFields.get(currentField.id)!;
      if (!same(fieldStructure(previousField), fieldStructure(currentField))) {
        fail(current, "E2807", `Field structure changed for '${currentEntity.name}.${currentField.name}'; only its name may change in 0.10.`);
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
    for (const currentField of fields.existing) {
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

    const invariants = additiveDiff(previousEntity.invariants, currentEntity.invariants, `Invariant in entity '${currentEntity.name}'`, current);
    if (invariants.added.length) {
      fail(current, "E2814", `Adding invariants to existing entity '${currentEntity.name}' requires explicit validation of stored rows.`);
    }
    const previousInvariants = byId(previousEntity.invariants);
    for (const currentInvariant of invariants.existing) {
      const previousInvariant = previousInvariants.get(currentInvariant.id)!;
      if (!same(invariantStructure(previousInvariant), invariantStructure(currentInvariant))) {
        fail(current, "E2807", `Invariant semantics changed for '${currentEntity.name}.${currentInvariant.name}'; only its name may change in 0.10.`);
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

    const exclusions = additiveDiff(previousEntity.temporalExclusions, currentEntity.temporalExclusions, `Exclusion in entity '${currentEntity.name}'`, current);
    if (exclusions.added.length) {
      fail(current, "E2815", `Adding temporal exclusions to existing entity '${currentEntity.name}' requires explicit validation of stored rows.`);
    }
    const previousExclusions = byId(previousEntity.temporalExclusions);
    for (const currentExclusion of exclusions.existing) {
      const previousExclusion = previousExclusions.get(currentExclusion.id)!;
      if (!same(exclusionStructure(previousExclusion), exclusionStructure(currentExclusion))) {
        fail(current, "E2807", `Exclusion semantics changed for '${currentEntity.name}.${currentExclusion.name}'; only its name may change in 0.10.`);
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

  const previousPolicies = (previous as ModelIR & { policies?: IRPolicy[] }).policies ?? [];
  const policyDiff = additiveDiff(previousPolicies, current.policies, "Policy", current);
  for (const policy of policyDiff.added) operations.push({ kind: "addPolicy", policyId: policy.id, name: policy.name });
  const previousPoliciesById = byId(previousPolicies);
  for (const currentPolicy of policyDiff.existing) {
    const previousPolicy = previousPoliciesById.get(currentPolicy.id)!;
    if (!same(policyStructure(previousPolicy), policyStructure(currentPolicy))) {
      fail(current, "E2807", `Policy signature changed for '${currentPolicy.name}'; only its name may change in a safe migration.`);
    }
    if (previousPolicy.name !== currentPolicy.name) operations.push({
      kind: "renamePolicy", policyId: currentPolicy.id, from: previousPolicy.name, to: currentPolicy.name,
    });
    const branches = additiveDiff(previousPolicy.branches, currentPolicy.branches, `Branch in policy '${currentPolicy.name}'`, current);
    if (branches.added.length) fail(current, "E2807", `Adding a branch to existing policy '${currentPolicy.name}' requires reviewed authority migration.`);
    const previousBranches = byId(previousPolicy.branches);
    for (const branch of branches.existing) {
      const previousBranch = previousBranches.get(branch.id)!;
      if (!same(policyBranchStructure(previousBranch), policyBranchStructure(branch))) {
        fail(current, "E2807", `Policy branch semantics changed for '${currentPolicy.name}.${branch.name}'; only its name may change in a safe migration.`);
      }
      if (previousBranch.name !== branch.name) operations.push({
        kind: "renamePolicyBranch", policyId: currentPolicy.id, branchId: branch.id, from: previousBranch.name, to: branch.name,
      });
    }
  }

  const previousEvents = (previous as ModelIR & { events?: ModelIR["events"] }).events ?? [];
  const eventDiff = additiveDiff(previousEvents, current.events, "Event", current);
  for (const event of eventDiff.added) operations.push({ kind: "addEvent", eventId: event.id, name: event.name });
  const previousEventsById = byId(previousEvents);
  for (const currentEvent of eventDiff.existing) {
    const previousEvent = previousEventsById.get(currentEvent.id)!;
    if (previousEvent.payloadEntityId !== currentEvent.payloadEntityId || !same(previousEvent.source ?? { kind: "local" }, currentEvent.source)) {
      fail(current, "E2807", `Event payload or source contract changed for '${currentEvent.name}'; contract changes require reviewed migration.`);
    }
  }

  const actionDiff = additiveDiff(previous.actions, current.actions, "Action", current);
  for (const action of actionDiff.added) {
    operations.push({ kind: "addAction", actionId: action.id, name: action.name });
  }

  const previousConsumers = (previous as ModelIR & { consumers?: IRConsumer[] }).consumers ?? [];
  const consumerDiff = additiveDiff(previousConsumers, current.consumers, "Consumer", current);
  for (const consumer of consumerDiff.added) operations.push({ kind: "addConsumer", consumerId: consumer.id, name: consumer.name });
  const previousConsumersById = byId(previousConsumers);
  for (const currentConsumer of consumerDiff.existing) {
    const previousConsumer = previousConsumersById.get(currentConsumer.id)!;
    if (!same(consumerStructure(previousConsumer), consumerStructure(currentConsumer))) {
      fail(current, "E2807", `Consumer contract or handler semantics changed for '${currentConsumer.name}'; reviewed migration is required.`);
    }
  }
  const previousActions = byId(previous.actions);
  for (const currentAction of actionDiff.existing) {
    const previousAction = previousActions.get(currentAction.id)!;
    if (!same(actionStructure(previousAction), actionStructure(currentAction))) {
      fail(current, "E2807", `Action semantics changed for '${currentAction.name}'; only its name may change in a 0.10 safe migration.`);
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

  const queryDiff = additiveDiff(previous.queries, current.queries, "Query", current);
  for (const query of queryDiff.added) {
    operations.push({ kind: "addQuery", queryId: query.id, name: query.name });
  }
  const previousQueries = byId(previous.queries);
  for (const currentQuery of queryDiff.existing) {
    const previousQuery = previousQueries.get(currentQuery.id)!;
    if (!same(queryStructure(previousQuery), queryStructure(currentQuery))) {
      fail(current, "E2807", `Query semantics changed for '${currentQuery.name}'; only its name may change in a 0.10 safe migration.`);
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

  const workflowDiff = additiveDiff(previous.workflows, current.workflows, "Workflow", current);
  const addedWorkflowIds = new Set(workflowDiff.added.map((workflow) => workflow.id));
  for (const workflow of workflowDiff.added) {
    operations.push({ kind: "addWorkflow", workflowId: workflow.id, name: workflow.name });
  }
  const previousWorkflows = byId(previous.workflows);
  const expandedWorkflowIds = new Set<string>();
  for (const currentWorkflow of workflowDiff.existing) {
    const previousWorkflow = previousWorkflows.get(currentWorkflow.id)!;
    if (JSON.stringify(previousWorkflow.naming) !== JSON.stringify(currentWorkflow.naming)
      || !same(workflowStructure(previousWorkflow), workflowStructure(currentWorkflow))) {
      fail(current, "E2807", `Workflow '${currentWorkflow.name}' changed; only transition additions are safe in 0.10.`);
    }
    const transitions = additiveDiff(
      previousWorkflow.transitions,
      currentWorkflow.transitions,
      `Transition in workflow '${currentWorkflow.name}'`,
      current,
    );
    if (transitions.added.length) expandedWorkflowIds.add(currentWorkflow.id);
    for (const transition of transitions.added) {
      operations.push({
        kind: "addTransition",
        workflowId: currentWorkflow.id,
        transitionId: transition.id,
        name: transition.name,
      });
    }
    const previousTransitions = byId(previousWorkflow.transitions);
    for (const transition of transitions.existing) {
      if (!same(transitionStructure(previousTransitions.get(transition.id)!), transitionStructure(transition))) {
        fail(current, "E2807", `Transition '${currentWorkflow.name}.${transition.name}' changed; existing workflow edges are immutable in 0.10.`);
      }
    }
  }

  if (previous.model.version === current.model.version) {
    fail(current, "E2810", `Safe migration requires a new model version; both inputs declare '${current.model.version}'.`);
  }

  const schema = quoteIdent(current.model.naming.sqlSchema);
  const renameStatements = operations.flatMap((operation): string[] => {
    switch (operation.kind) {
      case "renameEntity":
        return [`ALTER TABLE ${schema}.${quoteIdent(operation.from)} RENAME TO ${quoteIdent(operation.to)};`];
      case "renameField":
        return [`ALTER TABLE ${schema}.${quoteIdent(operation.table)} RENAME COLUMN ${quoteIdent(operation.from)} TO ${quoteIdent(operation.to)};`];
      case "renameEnum":
        return [`-- Semantic enum rename ${operation.from} -> ${operation.to}; stored values are unchanged.`];
      case "renamePolicy":
        return [`-- Semantic policy rename ${operation.from} -> ${operation.to}; stable decision identity is unchanged.`];
      case "renamePolicyBranch":
        return [`-- Semantic policy authority rename ${operation.from} -> ${operation.to}; durable authority identity is unchanged.`];
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
      default:
        return [];
    }
  });

  const structuralStatements: string[] = [...renameStatements];
  for (const enumeration of enumDiff.added) {
    structuralStatements.push(`-- Added semantic enum ${enumeration.name}; PostgreSQL stores enum values as constrained text.`);
  }
  for (const memberOperation of operations.filter((operation): operation is Extract<AdditiveOperation, { kind: "addEnumMember" }> =>
    operation.kind === "addEnumMember")) {
    structuralStatements.push(`-- Added enum member ${memberOperation.name} (${memberOperation.memberId}).`);
  }
  for (const entity of entityDiff.added) structuralStatements.push(generateEntityTableStatement(current, entity));
  for (const currentEntity of entityDiff.existing) {
    const previousEntity = previousEntities.get(currentEntity.id)!;
    const previousFieldIds = new Set(previousEntity.fields.map((field) => field.id));
    for (const field of currentEntity.fields.filter((candidate) => !previousFieldIds.has(candidate.id))) {
      structuralStatements.push(...generateAddFieldStatements(current, currentEntity, field));
    }
  }
  for (const entity of entityDiff.added) {
    structuralStatements.push(...generateEntityForeignKeyStatements(current, entity));
  }
  for (const enumId of expandedEnumIds) {
    for (const previousEntity of previous.entities) {
      const currentEntity = current.entities.find((candidate) => candidate.id === previousEntity.id)!;
      for (const previousField of previousEntity.fields.filter((field) =>
        field.type === enumId || field.type === `set:${enumId}`)) {
        const currentField = currentEntity.fields.find((candidate) => candidate.id === previousField.id)!;
        structuralStatements.push(...generateRefreshEnumConstraintStatements(current, currentEntity, currentField));
      }
    }
  }
  for (const workflow of current.workflows) {
    if (addedWorkflowIds.has(workflow.id)) {
      structuralStatements.push(...generateWorkflowStatements(current, workflow, true));
    } else if (expandedWorkflowIds.has(workflow.id)) {
      structuralStatements.push(...generateWorkflowStatements(current, workflow, false));
    }
  }

  const generated = generatePostgres(current);
  const internal = quoteIdent(current.model.naming.internalSchema);
  const sql = [
    `-- ModelLang safe schema migration ${previous.model.version} -> ${current.model.version}`,
    "BEGIN;",
    "-- Bootstrap the 0.12 shared gateway role before assuming the non-login owner role.",
    generateGatewayRoleStatements(),
    generateDispatcherRoleStatements(),
    generateConsumerRoleStatements(),
    ...(entityDiff.added.some((entity) => entity.temporalExclusions.length > 0)
      ? ["CREATE EXTENSION IF NOT EXISTS btree_gist;"]
      : []),
    "SET LOCAL ROLE modellang_owner;",
    ...historyBootstrapStatements(previous, current),
    ...(structuralStatements.length ? structuralStatements : ["-- No structural schema changes detected."]),
    "-- Upgrade the internal gateway identity and audit boundary after physical renames.",
    ...generateGatewayInfrastructureStatements(current),
    ...generateDecisionEvidenceInfrastructureStatements(current),
    ...generateCommandReceiptInfrastructureStatements(current),
    ...generateEventOutboxInfrastructureStatements(current),
    ...generateEventInboxInfrastructureStatements(current),
    "-- Redeploy the complete generated callable boundary and grants.",
    generated["003_actions.sql"]!.trim(),
    generated["003_consumers.sql"]!.trim(),
    generated["003_decisions.sql"]!.trim(),
    generated["003_queries.sql"]!.trim(),
    generated["004_grants.sql"]!.trim(),
    "SET LOCAL ROLE modellang_owner;",
    `INSERT INTO ${internal}.${quoteIdent("schema_migrations")} (${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}, ${quoteIdent("migration_kind")})`,
    `VALUES (${sqlText(current.model.id)}, ${sqlText(current.model.version)}, ${sqlText(current.model.sourceHash)}, 'safe');`,
    "COMMIT;",
    "",
  ].join("\n");
  return {
    previousVersion: previous.model.version,
    currentVersion: current.model.version,
    operations,
    sql,
  };
}
