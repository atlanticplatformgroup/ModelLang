import type { IRAction, IRConsumer, IREntity, IREnumMember, IRExpression, IRField, IRParameter, IRQuery, IRWorkflow, ModelIR } from "../ir.js";
import { isMoneyType, moneyMagnitudeLimit, moneyProfileFromType } from "../money.js";
import { quoteIdent, snakeCase } from "../naming.js";
import { decisionAction, decisionFunctionName, generateDecisionPlan, type ActionDecisionPlan, type DecisionPlan } from "../decision-plan.js";

export interface PostgresOutput {
  "001_roles.sql": string;
  "002_schema.sql": string;
  "003_actions.sql": string;
  "003_consumers.sql": string;
  "003_decisions.sql": string;
  "003_queries.sql": string;
  "004_grants.sql": string;
  "005_seed.sql": string;
  "006_upgrade_0_12.sql": string;
  "007_upgrade_0_17.sql": string;
  "008_upgrade_0_18.sql": string;
  "009_upgrade_0_19.sql": string;
  "010_upgrade_0_20.sql": string;
  "011_upgrade_0_21.sql": string;
  "012_upgrade_0_22.sql": string;
  "013_upgrade_0_23.sql": string;
  "014_upgrade_0_24.sql": string;
  "015_upgrade_0_25.sql": string;
}

function qname(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function entityById(ir: ModelIR, id: string): IREntity {
  const value = ir.entities.find((entity) => entity.id === id);
  if (!value) throw new Error(`E4001 Unknown entity ${id}`);
  return value;
}

function fieldById(ir: ModelIR, id: string): { entity: IREntity; field: IRField } {
  for (const entity of ir.entities) {
    const field = entity.fields.find((candidate) => candidate.id === id);
    if (field) return { entity, field };
  }
  throw new Error(`E4002 Unknown field ${id}`);
}

function enumMemberById(ir: ModelIR, enumId: string, memberId: string): IREnumMember {
  const member = ir.enums.find((enumeration) => enumeration.id === enumId)?.members.find((candidate) => candidate.id === memberId);
  if (!member) throw new Error(`E4009 Unknown enum member ${memberId}`);
  return member;
}

function sqlType(type: string): string {
  if (type.startsWith("entity:")) return "uuid";
  if (type.startsWith("set:enum:")) return "text[]";
  if (type.startsWith("enum:")) return "text";
  if (isMoneyType(type)) return "numeric";
  const types: Record<string, string> = {
    String: "text", Int: "bigint", Decimal: "numeric", Boolean: "boolean", UUID: "uuid", DateTime: "timestamptz",
  };
  const result = types[type];
  if (!result) throw new Error(`E4003 Unsupported SQL type ${type}`);
  return result;
}

function sqlLiteral(expression: IRExpression, ir: ModelIR): string {
  if (expression.kind === "nullLiteral") return "NULL";
  if (expression.kind === "moneyLiteral") return expression.amount;
  if (expression.kind === "enumLiteral") {
    const value = enumMemberById(ir, expression.enumId, expression.memberId).naming.sqlValue;
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (expression.kind !== "literal") throw new Error("E4004 Default is not a literal.");
  if (typeof expression.value === "string") return `'${expression.value.replaceAll("'", "''")}'`;
  if (typeof expression.value === "boolean") return expression.value ? "TRUE" : "FALSE";
  return String(expression.value);
}

function columnDefinition(ir: ModelIR, field: IRField): string {
  const pieces = [quoteIdent(field.naming.sqlColumn), sqlType(field.type)];
  if (!field.optional) pieces.push("NOT NULL");
  if (field.default) pieces.push(`DEFAULT ${sqlLiteral(field.default, ir)}`);
  if (field.generation?.strategy === "uuid") pieces.push("DEFAULT pg_catalog.gen_random_uuid()");
  if (field.generation?.strategy === "now") pieces.push("DEFAULT pg_catalog.transaction_timestamp()");
  if (field.annotations.some((annotation) => annotation.name === "id")) pieces.push("PRIMARY KEY");
  return pieces.join(" ");
}

function fieldConstraintBodies(ir: ModelIR, entity: IREntity, field: IRField): string[] {
  const constraints: string[] = [];
  if (field.type.startsWith("set:enum:")) {
    const enumId = field.type.slice("set:".length);
    const enumeration = ir.enums.find((candidate) => candidate.id === enumId)!;
    const column = quoteIdent(field.naming.sqlColumn);
    const members = enumeration.members.map((member) => `'${member.naming.sqlValue.replaceAll("'", "''")}'`);
    const tests = [
      `${column} <@ ARRAY[${members.join(", ")}]::text[]`,
      `pg_catalog.array_position(${column}, NULL::text) IS NULL`,
      ...members.map((member) => `pg_catalog.cardinality(pg_catalog.array_positions(${column}, ${member})) <= 1`),
    ];
    const test = tests.join(" AND ");
    constraints.push(`CONSTRAINT ${quoteIdent(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum_set`)} CHECK ((${field.optional ? `${column} IS NULL OR (${test})` : test}) IS TRUE)`);
  }
  if (field.type.startsWith("enum:")) {
    const enumeration = ir.enums.find((candidate) => candidate.id === field.type)!;
    const members = enumeration.members.map((member) => `'${member.naming.sqlValue.replaceAll("'", "''")}'`).join(", ");
    const test = `${quoteIdent(field.naming.sqlColumn)} IN (${members})`;
    const optionalTest = field.optional ? `(${quoteIdent(field.naming.sqlColumn)} IS NULL OR ${test})` : test;
    constraints.push(`CONSTRAINT ${quoteIdent(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum`)} CHECK ((${optionalTest}) IS TRUE)`);
  }
  if (isMoneyType(field.type)) {
    const profile = moneyProfileFromType(field.type)!;
    const column = quoteIdent(field.naming.sqlColumn);
    const test = `${column} <> 'NaN'::numeric AND pg_catalog.scale(${column}) <= ${profile.scale} AND pg_catalog.abs(${column}) < ${moneyMagnitudeLimit(profile)}`;
    constraints.push(`CONSTRAINT ${quoteIdent(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_money`)} CHECK ((${field.optional ? `${column} IS NULL OR (${test})` : test}) IS TRUE)`);
  }
  for (const annotation of field.annotations) {
    if (annotation.name === "unique") {
      constraints.push(`CONSTRAINT ${quoteIdent(`uq_${entity.naming.sqlTable}_${field.naming.sqlColumn}_unique`)} UNIQUE (${quoteIdent(field.naming.sqlColumn)})`);
    }
    if (annotation.name === "min" || annotation.name === "minExclusive") {
      const operator = annotation.name === "minExclusive" ? ">" : ">=";
      const test = `${quoteIdent(field.naming.sqlColumn)} ${operator} ${annotation.value}`;
      constraints.push(`CONSTRAINT ${quoteIdent(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_${snakeCase(annotation.name)}`)} CHECK ((${field.optional ? `${quoteIdent(field.naming.sqlColumn)} IS NULL OR ${test}` : test}) IS TRUE)`);
    }
    if (annotation.name === "max") {
      const test = `${quoteIdent(field.naming.sqlColumn)} <= ${annotation.value}`;
      constraints.push(`CONSTRAINT ${quoteIdent(`ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_max`)} CHECK ((${field.optional ? `${quoteIdent(field.naming.sqlColumn)} IS NULL OR ${test}` : test}) IS TRUE)`);
    }
  }
  return constraints;
}

interface ExpressionContext {
  ir: ModelIR;
  action?: IRAction;
  consumer?: IRConsumer;
  query?: IRQuery;
  selfEntity?: IREntity;
  recordNames?: Map<string, string>;
  policyBindings?: Map<string, string>;
  policyRecordBindings?: Map<string, string>;
}

function lowerExpression(expression: IRExpression, context: ExpressionContext): string {
  switch (expression.kind) {
    case "literal": return sqlLiteral(expression, context.ir);
    case "moneyLiteral": return sqlLiteral(expression, context.ir);
    case "nullLiteral": return "NULL";
    case "enumLiteral": return sqlLiteral(expression, context.ir);
    case "policyCall": return lowerPolicyCall(expression, context);
    case "parameter": {
      const binding = context.policyBindings?.get(expression.parameterId);
      if (binding) return binding;
      const parameter = context.action?.parameters.find((candidate) => candidate.id === expression.parameterId)
        ?? (context.consumer?.payloadParameter.id === expression.parameterId ? context.consumer.payloadParameter : undefined)
        ?? context.query?.parameters.find((candidate) => candidate.id === expression.parameterId);
      if (!parameter) throw new Error(`E4005 Missing parameter ${expression.parameterId}`);
      return quoteIdent(parameter.naming.sqlParameter);
    }
    case "entityValue": {
      const binding = context.policyBindings?.get(expression.parameterId);
      if (binding) return binding;
      const record = context.recordNames?.get(expression.parameterId) ?? context.policyRecordBindings?.get(expression.parameterId);
      if (!record) throw new Error(`E4006 Missing entity record ${expression.parameterId}`);
      return `${record}.${quoteIdent("id")}`;
    }
    case "fieldAccess": {
      const { field } = fieldById(context.ir, expression.fieldId);
      if (expression.source === "self") return quoteIdent(field.naming.sqlColumn);
      const record = context.recordNames?.get(expression.source) ?? context.policyRecordBindings?.get(expression.source);
      if (!record) throw new Error(`E4007 Missing field record ${expression.source}`);
      return `${record}.${quoteIdent(field.naming.sqlColumn)}`;
    }
    case "unary": return `(NOT ${lowerExpression(expression.operand, context)})`;
    case "binary":
      if (expression.operator === "in") {
        return `(${lowerExpression(expression.left, context)} = ANY(${lowerExpression(expression.right, context)}))`;
      }
      return `(${lowerExpression(expression.left, context)} ${sqlOperator(expression.operator)} ${lowerExpression(expression.right, context)})`;
    case "nullComparison":
      return `(${lowerExpression(expression.operand, context)} ${expression.operator === "isNull" ? "IS NULL" : "IS NOT NULL"})`;
  }
}

function policyContext(
  expression: Extract<IRExpression, { kind: "policyCall" }>,
  context: ExpressionContext,
): { policy: ModelIR["policies"][number]; context: ExpressionContext } {
  const policy = context.ir.policies.find((candidate) => candidate.id === expression.policyId);
  if (!policy) throw new Error(`E4011 Missing policy ${expression.policyId}`);
  const bindings = new Map(context.policyBindings);
  const recordBindings = new Map(context.policyRecordBindings);
  policy.parameters.forEach((parameter, index) => {
    const argument = expression.arguments[index]!;
    bindings.set(parameter.id, `(${lowerExpression(argument, context)})`);
    if (argument.kind === "entityValue") {
      const record = context.recordNames?.get(argument.parameterId) ?? context.policyRecordBindings?.get(argument.parameterId);
      if (record) recordBindings.set(parameter.id, record);
    }
  });
  return { policy, context: { ...context, policyBindings: bindings, policyRecordBindings: recordBindings } };
}

function lowerPolicyCall(expression: Extract<IRExpression, { kind: "policyCall" }>, context: ExpressionContext): string {
  const resolved = policyContext(expression, context);
  const matches = resolved.policy.branches.map((branch) =>
    `(CASE WHEN ((${lowerExpression(branch.expression, resolved.context)}) IS TRUE) THEN 1 ELSE 0 END)`);
  return `((${matches.join(" + ")}) = 1)`;
}

function policyAuthorityBranchSql(expression: Extract<IRExpression, { kind: "policyCall" }>, context: ExpressionContext): string {
  const resolved = policyContext(expression, context);
  return `CASE ${resolved.policy.branches.map((branch) =>
    `WHEN ((${lowerExpression(branch.expression, resolved.context)}) IS TRUE) THEN '${branch.id.replaceAll("'", "''")}'`).join(" ")} ELSE NULL END`;
}

function authorityPolicyCall(expression: IRExpression): Extract<IRExpression, { kind: "policyCall" }> | undefined {
  if (expression.kind === "policyCall") return expression;
  if (expression.kind === "binary") return authorityPolicyCall(expression.left) ?? authorityPolicyCall(expression.right);
  if (expression.kind === "unary") return authorityPolicyCall(expression.operand);
  if (expression.kind === "nullComparison") return authorityPolicyCall(expression.operand);
  return undefined;
}

function sqlOperator(operator: Exclude<Extract<IRExpression, { kind: "binary" }>["operator"], "in">): string {
  return ({ and: "AND", or: "OR", "==": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=" } as const)[operator];
}

export function generateEntityTableStatement(ir: ModelIR, entity: IREntity): string {
  const columns = entity.fields.map((field) => `  ${columnDefinition(ir, field)}`);
  const constraints = entity.fields.flatMap((field) => fieldConstraintBodies(ir, entity, field).map((constraint) => `  ${constraint}`));
  for (const invariant of entity.invariants) {
    constraints.push(`  CONSTRAINT ${quoteIdent(invariant.naming.sqlConstraint)} CHECK ((${lowerExpression(invariant.expression, { ir, selfEntity: entity })}) IS TRUE)`);
  }
  for (const exclusion of entity.temporalExclusions) {
    const key = fieldById(ir, exclusion.keyFieldId).field;
    const start = fieldById(ir, exclusion.startFieldId).field;
    const end = fieldById(ir, exclusion.endFieldId).field;
    constraints.push(
      `  CONSTRAINT ${quoteIdent(exclusion.naming.sqlValidIntervalConstraint)} CHECK ((${quoteIdent(start.naming.sqlColumn)} < ${quoteIdent(end.naming.sqlColumn)}) IS TRUE)`,
      `  CONSTRAINT ${quoteIdent(exclusion.naming.sqlExclusionConstraint)} EXCLUDE USING gist (${quoteIdent(key.naming.sqlColumn)} WITH =, pg_catalog.tstzrange(${quoteIdent(start.naming.sqlColumn)}, ${quoteIdent(end.naming.sqlColumn)}, '${exclusion.intervalBounds}') WITH &&)`,
    );
  }
  return `CREATE TABLE ${qname(ir.model.naming.sqlSchema, entity.naming.sqlTable)} (\n${[...columns, ...constraints].join(",\n")}\n);`;
}

export function generateEntityForeignKeyStatements(ir: ModelIR, entity: IREntity): string[] {
  return entity.fields.filter((field) => field.type.startsWith("entity:")).map((field) => {
    const target = entityById(ir, field.type);
    return `ALTER TABLE ${qname(ir.model.naming.sqlSchema, entity.naming.sqlTable)}
  ADD CONSTRAINT ${quoteIdent(`fk_${entity.naming.sqlTable}_${field.naming.sqlColumn}`)}
  FOREIGN KEY (${quoteIdent(field.naming.sqlColumn)}) REFERENCES ${qname(ir.model.naming.sqlSchema, target.naming.sqlTable)} (${quoteIdent("id")});`;
  });
}

export function generateAddFieldStatements(ir: ModelIR, entity: IREntity, field: IRField): string[] {
  const table = qname(ir.model.naming.sqlSchema, entity.naming.sqlTable);
  const statements = [`ALTER TABLE ${table} ADD COLUMN ${columnDefinition(ir, field)};`];
  statements.push(...fieldConstraintBodies(ir, entity, field).map((constraint) =>
    `ALTER TABLE ${table} ADD ${constraint};`));
  if (field.type.startsWith("entity:")) {
    const target = entityById(ir, field.type);
    statements.push(`ALTER TABLE ${table}
  ADD CONSTRAINT ${quoteIdent(`fk_${entity.naming.sqlTable}_${field.naming.sqlColumn}`)}
  FOREIGN KEY (${quoteIdent(field.naming.sqlColumn)}) REFERENCES ${qname(ir.model.naming.sqlSchema, target.naming.sqlTable)} (${quoteIdent("id")});`);
  }
  return statements;
}

export function generateRefreshEnumConstraintStatements(ir: ModelIR, entity: IREntity, field: IRField): string[] {
  const constraint = fieldConstraintBodies(ir, entity, field).find((candidate) =>
    field.type.startsWith("set:enum:") ? candidate.includes("_enum_set") : candidate.includes("_enum"));
  if (!constraint) throw new Error(`E4010 Missing enum constraint for ${entity.name}.${field.name}`);
  const name = field.type.startsWith("set:enum:")
    ? `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum_set`
    : `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum`;
  const table = qname(ir.model.naming.sqlSchema, entity.naming.sqlTable);
  return [
    `ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(name)};`,
    `ALTER TABLE ${table} ADD ${constraint};`,
  ];
}

export function generateWorkflowStatements(
  ir: ModelIR,
  workflow: IRWorkflow,
  createTriggers: boolean,
): string[] {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const entity = entityById(ir, workflow.entityId);
  const field = fieldById(ir, workflow.fieldId).field;
  const initial = enumMemberById(ir, workflow.enumId, workflow.initialMemberId);
  const allowed = workflow.transitions.map((transition) => {
    const from = enumMemberById(ir, workflow.enumId, transition.fromMemberId).naming.sqlValue.replaceAll("'", "''");
    const to = enumMemberById(ir, workflow.enumId, transition.toMemberId).naming.sqlValue.replaceAll("'", "''");
    return `(OLD.${quoteIdent(field.naming.sqlColumn)} = '${from}' AND NEW.${quoteIdent(field.naming.sqlColumn)} = '${to}')`;
  });
  const workflowRule = workflow.id.replaceAll("'", "''");
  const statements = [
    `CREATE OR REPLACE FUNCTION ${qname(internal, workflow.naming.sqlTriggerFunction)}()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $modellang$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.${quoteIdent(field.naming.sqlColumn)} IS DISTINCT FROM '${initial.naming.sqlValue.replaceAll("'", "''")}' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ML_WORKFLOW:${workflowRule}', CONSTRAINT = '${workflow.naming.sqlInsertTrigger.replaceAll("'", "''")}';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.${quoteIdent(field.naming.sqlColumn)} IS NOT DISTINCT FROM OLD.${quoteIdent(field.naming.sqlColumn)} THEN
    RETURN NEW;
  END IF;

  IF NOT (${allowed.length ? allowed.join("\n    OR ") : "FALSE"}) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ML_WORKFLOW:${workflowRule}', CONSTRAINT = '${workflow.naming.sqlUpdateTrigger.replaceAll("'", "''")}';
  END IF;
  RETURN NEW;
END
$modellang$;`,
    `REVOKE ALL ON FUNCTION ${qname(internal, workflow.naming.sqlTriggerFunction)}() FROM PUBLIC;`,
  ];
  if (createTriggers) {
    statements.push(
      `CREATE TRIGGER ${quoteIdent(workflow.naming.sqlInsertTrigger)}
AFTER INSERT ON ${qname(schema, entity.naming.sqlTable)}
FOR EACH ROW EXECUTE FUNCTION ${qname(internal, workflow.naming.sqlTriggerFunction)}();`,
      `CREATE TRIGGER ${quoteIdent(workflow.naming.sqlUpdateTrigger)}
BEFORE UPDATE OF ${quoteIdent(field.naming.sqlColumn)} ON ${qname(schema, entity.naming.sqlTable)}
FOR EACH ROW EXECUTE FUNCTION ${qname(internal, workflow.naming.sqlTriggerFunction)}();`,
    );
  }
  return statements;
}

export function generateGatewayRoleStatements(): string {
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_gateway') THEN
    CREATE ROLE modellang_gateway NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_gateway NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;`;
}

export function generateDispatcherRoleStatements(): string {
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_dispatcher') THEN
    CREATE ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;`;
}

export function generateConsumerRoleStatements(): string {
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_consumer') THEN
    CREATE ROLE modellang_consumer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_consumer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;
REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;`;
}

export function generateRecoveryRoleStatements(): string {
  return `DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_recovery') THEN
    CREATE ROLE modellang_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer FROM modellang_recovery;
REVOKE modellang_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;`;
}

function generateRoles(): string {
  return `-- Generated by ModelLang. Administrative bootstrap; run as a role with CREATEROLE.
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_owner') THEN
    CREATE ROLE modellang_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_app') THEN
    CREATE ROLE modellang_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE modellang_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner FROM modellang_app;

${generateGatewayRoleStatements()}

${generateDispatcherRoleStatements()}

${generateConsumerRoleStatements()}

${generateRecoveryRoleStatements()}
`;
}

function generateSnapshotResolverStatements(ir: ModelIR): string[] {
  const internal = ir.model.naming.internalSchema;
  return [
    `CREATE OR REPLACE FUNCTION ${qname(internal, "resolve_principal_snapshot")}()`,
    `RETURNS TABLE (${quoteIdent("principal_id")} uuid)`,
    "LANGUAGE plpgsql",
    "STABLE",
    "SECURITY DEFINER",
    "SET search_path = pg_catalog, pg_temp",
    "AS $modellang$",
    "DECLARE",
    "  v_issuer text;",
    "  v_subject text;",
    "BEGIN",
    "  IF EXISTS (",
    "    SELECT 1",
    "    FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);",
    "    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);",
    "    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN",
    "      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';",
    "    END IF;",
    "    RETURN QUERY",
    `      SELECT binding.${quoteIdent("principal_id")}`,
    `      FROM ${qname(internal, "gateway_principal_binding")} AS binding`,
    `      WHERE binding.${quoteIdent("issuer")} = v_issuer AND binding.${quoteIdent("subject")} = v_subject;`,
    "  ELSE",
    "    RETURN QUERY",
    `      SELECT binding.${quoteIdent("principal_id")}`,
    `      FROM ${qname(internal, "principal_binding")} AS binding`,
    `      WHERE binding.${quoteIdent("database_principal")} = session_user;`,
    "  END IF;",
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';",
    "  END IF;",
    "END",
    "$modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "resolve_principal_snapshot")}() FROM PUBLIC;`,
  ];
}

export function generateGatewayInfrastructureStatements(ir: ModelIR, includeSnapshotResolver = true): string[] {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const principal = entityById(ir, ir.principal.entityId);
  const auditConstraint = quoteIdent("ck_action_audit_gateway_identity");
  return [
    `CREATE TABLE IF NOT EXISTS ${qname(internal, "gateway_principal_binding")} (`,
    `  ${quoteIdent("issuer")} text NOT NULL,`,
    `  ${quoteIdent("subject")} text NOT NULL,`,
    `  ${quoteIdent("principal_id")} uuid NOT NULL REFERENCES ${qname(schema, principal.naming.sqlTable)} (${quoteIdent("id")}),`,
    `  PRIMARY KEY (${quoteIdent("issuer")}, ${quoteIdent("subject")}),`,
    `  CONSTRAINT ${quoteIdent("ck_gateway_principal_binding_identity")} CHECK (`,
    `    pg_catalog.char_length(${quoteIdent("issuer")}) BETWEEN 1 AND 512`,
    `    AND pg_catalog.char_length(${quoteIdent("subject")}) BETWEEN 1 AND 512`,
    "  )",
    ");",
    `ALTER TABLE ${qname(internal, "action_audit")} ADD COLUMN IF NOT EXISTS ${quoteIdent("identity_issuer")} text;`,
    `ALTER TABLE ${qname(internal, "action_audit")} ADD COLUMN IF NOT EXISTS ${quoteIdent("identity_subject")} text;`,
    `DO $modellang$`,
    "BEGIN",
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_constraint",
    `    WHERE conrelid = '${qname(internal, "action_audit")}'::regclass`,
    `      AND conname = 'ck_action_audit_gateway_identity'`,
    "  ) THEN",
    `    ALTER TABLE ${qname(internal, "action_audit")} ADD CONSTRAINT ${auditConstraint}`,
    `      CHECK ((${quoteIdent("identity_issuer")} IS NULL) = (${quoteIdent("identity_subject")} IS NULL));`,
    "  END IF;",
    "END",
    "$modellang$;",
    `CREATE OR REPLACE FUNCTION ${qname(internal, "bind_gateway_identity")}(p_issuer text, p_subject text)`,
    "RETURNS void",
    "LANGUAGE plpgsql",
    "SECURITY DEFINER",
    "SET search_path = pg_catalog, pg_temp",
    "AS $modellang$",
    "BEGIN",
    "  IF NOT EXISTS (",
    "    SELECT 1",
    "    FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_GATEWAY_REQUIRED';",
    "  END IF;",
    "  IF p_issuer IS NULL OR pg_catalog.char_length(p_issuer) NOT BETWEEN 1 AND 512",
    "     OR p_subject IS NULL OR pg_catalog.char_length(p_subject) NOT BETWEEN 1 AND 512 THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:gateway_identity';",
    "  END IF;",
    `  PERFORM 1 FROM ${qname(internal, "gateway_principal_binding")} AS binding`,
    `  WHERE binding.${quoteIdent("issuer")} = p_issuer AND binding.${quoteIdent("subject")} = p_subject`,
    "  FOR SHARE;",
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';",
    "  END IF;",
    "  PERFORM pg_catalog.set_config('modellang.gateway_issuer', p_issuer, true);",
    "  PERFORM pg_catalog.set_config('modellang.gateway_subject', p_subject, true);",
    "END",
    "$modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "bind_gateway_identity")}(text, text) FROM PUBLIC;`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "resolve_principal")}()`,
    `RETURNS TABLE (${quoteIdent("principal_id")} uuid, ${quoteIdent("identity_issuer")} text, ${quoteIdent("identity_subject")} text)`,
    "LANGUAGE plpgsql",
    "SECURITY DEFINER",
    "SET search_path = pg_catalog, pg_temp",
    "AS $modellang$",
    "DECLARE",
    "  v_issuer text;",
    "  v_subject text;",
    "BEGIN",
    "  IF EXISTS (",
    "    SELECT 1",
    "    FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);",
    "    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);",
    "    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN",
    "      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';",
    "    END IF;",
    "    RETURN QUERY",
    `      SELECT binding.${quoteIdent("principal_id")}, binding.${quoteIdent("issuer")}, binding.${quoteIdent("subject")}`,
    `      FROM ${qname(internal, "gateway_principal_binding")} AS binding`,
    `      WHERE binding.${quoteIdent("issuer")} = v_issuer AND binding.${quoteIdent("subject")} = v_subject`,
    "      FOR SHARE;",
    "  ELSE",
    "    RETURN QUERY",
    `      SELECT binding.${quoteIdent("principal_id")}, NULL::text, NULL::text`,
    `      FROM ${qname(internal, "principal_binding")} AS binding`,
    `      WHERE binding.${quoteIdent("database_principal")} = session_user`,
    "      FOR SHARE;",
    "  END IF;",
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';",
    "  END IF;",
    "END",
    "$modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "resolve_principal")}() FROM PUBLIC;`,
    ...(includeSnapshotResolver ? generateSnapshotResolverStatements(ir) : []),
  ];
}

export function generateDecisionEvidenceInfrastructureStatements(ir: ModelIR): string[] {
  const audit = qname(ir.model.naming.internalSchema, "action_audit");
  const constraint = quoteIdent("ck_action_audit_decision_evidence");
  return [
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("model_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("model_version")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("source_hash")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("authorization_rule_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("decision_outcome")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("policy_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("authority_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("decision_evidence")} jsonb;`,
    "DO $modellang$",
    "BEGIN",
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_constraint",
    `    WHERE conrelid = '${audit}'::regclass`,
    "      AND conname = 'ck_action_audit_decision_evidence'",
    "  ) THEN",
    `    ALTER TABLE ${audit} ADD CONSTRAINT ${constraint} CHECK (`,
    `      (${quoteIdent("decision_evidence")} IS NULL`,
    `       AND ${quoteIdent("model_id")} IS NULL AND ${quoteIdent("model_version")} IS NULL`,
    `       AND ${quoteIdent("source_hash")} IS NULL AND ${quoteIdent("authorization_rule_id")} IS NULL`,
    `       AND ${quoteIdent("decision_outcome")} IS NULL AND ${quoteIdent("policy_id")} IS NULL AND ${quoteIdent("authority_id")} IS NULL)`,
    "      OR",
    `      (${quoteIdent("decision_evidence")} IS NOT NULL`,
    `       AND ${quoteIdent("model_id")} IS NOT NULL AND ${quoteIdent("model_version")} IS NOT NULL`,
    `       AND ${quoteIdent("source_hash")} ~ '^sha256:[0-9a-f]{64}$'`,
    `       AND ${quoteIdent("authorization_rule_id")} IS NOT NULL AND ${quoteIdent("decision_outcome")} = 'executed'`,
    `       AND ((${quoteIdent("policy_id")} IS NULL) = (${quoteIdent("authority_id")} IS NULL)))`,
    "    );",
    "  END IF;",
    "END",
    "$modellang$;",
  ];
}

export function generateCommandReceiptInfrastructureStatements(ir: ModelIR): string[] {
  const internal = ir.model.naming.internalSchema;
  const audit = qname(internal, "action_audit");
  const receipts = qname(internal, "command_receipt");
  return [
    `CREATE TABLE IF NOT EXISTS ${receipts} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("model_id")} text NOT NULL,`,
    `  ${quoteIdent("model_version")} text NOT NULL,`,
    `  ${quoteIdent("source_hash")} text NOT NULL,`,
    `  ${quoteIdent("action_id")} text NOT NULL,`,
    `  ${quoteIdent("principal_id")} uuid NOT NULL,`,
    `  ${quoteIdent("idempotency_key")} text NOT NULL,`,
    `  ${quoteIdent("request_hash")} text NOT NULL,`,
    `  ${quoteIdent("correlation_id")} text NOT NULL,`,
    `  ${quoteIdent("causation_id")} text,`,
    `  ${quoteIdent("status")} text NOT NULL DEFAULT 'executing',`,
    `  ${quoteIdent("response")} jsonb,`,
    `  ${quoteIdent("target_id")} uuid,`,
    `  ${quoteIdent("action_audit_id")} bigint UNIQUE REFERENCES ${audit} (${quoteIdent("id")}),`,
    `  ${quoteIdent("created_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),`,
    `  ${quoteIdent("completed_at")} timestamptz,`,
    `  CONSTRAINT ${quoteIdent("uq_command_receipt_identity")} UNIQUE (${quoteIdent("principal_id")}, ${quoteIdent("action_id")}, ${quoteIdent("idempotency_key")}),`,
    `  CONSTRAINT ${quoteIdent("ck_command_receipt_hashes")} CHECK (${quoteIdent("source_hash")} ~ '^sha256:[0-9a-f]{64}$' AND ${quoteIdent("request_hash")} ~ '^sha256:[0-9a-f]{64}$'),`,
    `  CONSTRAINT ${quoteIdent("ck_command_receipt_ids")} CHECK (${quoteIdent("idempotency_key")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ${quoteIdent("correlation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND (${quoteIdent("causation_id")} IS NULL OR ${quoteIdent("causation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),`,
    `  CONSTRAINT ${quoteIdent("ck_command_receipt_completion")} CHECK (`,
    `    (${quoteIdent("status")} = 'executing' AND ${quoteIdent("response")} IS NULL AND ${quoteIdent("target_id")} IS NULL AND ${quoteIdent("action_audit_id")} IS NULL AND ${quoteIdent("completed_at")} IS NULL)`,
    `    OR (${quoteIdent("status")} = 'executed' AND ${quoteIdent("response")} IS NOT NULL AND ${quoteIdent("target_id")} IS NOT NULL AND ${quoteIdent("action_audit_id")} IS NOT NULL AND ${quoteIdent("completed_at")} IS NOT NULL)`,
    "  )",
    ");",
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("correlation_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("causation_id")} text;`,
    `ALTER TABLE ${audit} ADD COLUMN IF NOT EXISTS ${quoteIdent("command_receipt_id")} bigint;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent("uq_action_audit_command_receipt")} ON ${audit} (${quoteIdent("command_receipt_id")}) WHERE ${quoteIdent("command_receipt_id")} IS NOT NULL;`,
    "DO $modellang$",
    "BEGIN",
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_constraint",
    `    WHERE conrelid = '${audit}'::regclass AND conname = 'fk_action_audit_command_receipt'`,
    "  ) THEN",
    `    ALTER TABLE ${audit} ADD CONSTRAINT ${quoteIdent("fk_action_audit_command_receipt")} FOREIGN KEY (${quoteIdent("command_receipt_id")}) REFERENCES ${receipts} (${quoteIdent("id")});`,
    "  END IF;",
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_constraint",
    `    WHERE conrelid = '${audit}'::regclass AND conname = 'ck_action_audit_command_metadata'`,
    "  ) THEN",
    `    ALTER TABLE ${audit} ADD CONSTRAINT ${quoteIdent("ck_action_audit_command_metadata")} CHECK (`,
    `      (${quoteIdent("correlation_id")} IS NULL AND ${quoteIdent("causation_id")} IS NULL AND ${quoteIdent("command_receipt_id")} IS NULL)`,
    `      OR (${quoteIdent("correlation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND (${quoteIdent("causation_id")} IS NULL OR ${quoteIdent("causation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))`,
    "    );",
    "  END IF;",
    "END",
    "$modellang$;",
  ];
}

export function generateEventOutboxInfrastructureStatements(ir: ModelIR): string[] {
  const internal = ir.model.naming.internalSchema;
  const outbox = qname(internal, "event_outbox");
  const audit = qname(internal, "action_audit");
  const receipts = qname(internal, "command_receipt");
  const consumerAudit = qname(internal, "consumer_audit");
  const dispatcherCheck = [
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';",
    "  END IF;",
  ];
  return [
    `CREATE TABLE IF NOT EXISTS ${outbox} (`,
    `  ${quoteIdent("id")} uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),`,
    `  ${quoteIdent("model_id")} text NOT NULL,`,
    `  ${quoteIdent("model_version")} text NOT NULL,`,
    `  ${quoteIdent("source_hash")} text NOT NULL,`,
    `  ${quoteIdent("event_id")} text NOT NULL,`,
    `  ${quoteIdent("event_name")} text NOT NULL,`,
    `  ${quoteIdent("payload_entity_id")} text NOT NULL,`,
    `  ${quoteIdent("action_id")} text,`,
    `  ${quoteIdent("consumer_id")} text,`,
    `  ${quoteIdent("principal_id")} uuid,`,
    `  ${quoteIdent("target_id")} uuid NOT NULL,`,
    `  ${quoteIdent("payload")} jsonb NOT NULL,`,
    `  ${quoteIdent("correlation_id")} text NOT NULL,`,
    `  ${quoteIdent("causation_id")} text,`,
    `  ${quoteIdent("action_audit_id")} bigint REFERENCES ${audit} (${quoteIdent("id")}),`,
    `  ${quoteIdent("consumer_audit_id")} bigint CONSTRAINT ${quoteIdent("fk_event_outbox_consumer_audit")} REFERENCES ${consumerAudit} (${quoteIdent("id")}),`,
    `  ${quoteIdent("command_receipt_id")} bigint REFERENCES ${receipts} (${quoteIdent("id")}),`,
    `  ${quoteIdent("ordinal")} integer NOT NULL,`,
    `  ${quoteIdent("occurred_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),`,
    `  ${quoteIdent("delivery_attempts")} integer NOT NULL DEFAULT 0,`,
    `  ${quoteIdent("publication_failure_count")} integer NOT NULL DEFAULT 0,`,
    `  ${quoteIdent("publication_max_attempts")} integer,`,
    `  ${quoteIdent("publication_disposition")} text NOT NULL DEFAULT 'pending',`,
    `  ${quoteIdent("last_publication_error_code")} text,`,
    `  ${quoteIdent("publication_terminal_at")} timestamptz,`,
    `  ${quoteIdent("lease_token")} uuid,`,
    `  ${quoteIdent("leased_until")} timestamptz,`,
    `  ${quoteIdent("published_at")} timestamptz,`,
    `  CONSTRAINT ${quoteIdent("uq_event_outbox_action_ordinal")} UNIQUE (${quoteIdent("action_audit_id")}, ${quoteIdent("ordinal")}),`,
    `  CONSTRAINT ${quoteIdent("uq_event_outbox_consumer_ordinal")} UNIQUE (${quoteIdent("consumer_audit_id")}, ${quoteIdent("ordinal")}),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_producer")} CHECK ((` +
      `${quoteIdent("action_id")} IS NOT NULL AND ${quoteIdent("action_id")} ~ '^action:.+$' AND ${quoteIdent("consumer_id")} IS NULL AND ${quoteIdent("action_audit_id")} IS NOT NULL AND ${quoteIdent("consumer_audit_id")} IS NULL AND ${quoteIdent("principal_id")} IS NOT NULL) OR (` +
      `${quoteIdent("action_id")} IS NULL AND ${quoteIdent("consumer_id")} IS NOT NULL AND ${quoteIdent("consumer_id")} ~ '^consumer:.+$' AND ${quoteIdent("action_audit_id")} IS NULL AND ${quoteIdent("consumer_audit_id")} IS NOT NULL AND ${quoteIdent("principal_id")} IS NULL AND ${quoteIdent("command_receipt_id")} IS NULL)),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_hash")} CHECK (${quoteIdent("source_hash")} ~ '^sha256:[0-9a-f]{64}$'),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_metadata")} CHECK (${quoteIdent("correlation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND (${quoteIdent("causation_id")} IS NULL OR ${quoteIdent("causation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_delivery")} CHECK (${quoteIdent("delivery_attempts")} >= 0 AND ${quoteIdent("publication_failure_count")} >= 0 AND (${quoteIdent("publication_max_attempts")} IS NULL OR ${quoteIdent("publication_max_attempts")} BETWEEN 1 AND 1000) AND ((${quoteIdent("lease_token")} IS NULL) = (${quoteIdent("leased_until")} IS NULL))),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_publication_error")} CHECK (${quoteIdent("last_publication_error_code")} IS NULL OR ${quoteIdent("last_publication_error_code")} ~ '^ML_[A-Z_]+$'),`,
    `  CONSTRAINT ${quoteIdent("ck_event_outbox_publication_disposition")} CHECK ((` +
      `${quoteIdent("publication_disposition")} = 'pending' AND ${quoteIdent("published_at")} IS NULL AND ${quoteIdent("publication_terminal_at")} IS NULL) OR (` +
      `${quoteIdent("publication_disposition")} = 'published' AND ${quoteIdent("published_at")} IS NOT NULL AND ${quoteIdent("publication_terminal_at")} IS NULL AND ${quoteIdent("lease_token")} IS NULL) OR (` +
      `${quoteIdent("publication_disposition")} = 'deadLetter' AND ${quoteIdent("published_at")} IS NULL AND ${quoteIdent("publication_terminal_at")} IS NOT NULL AND ${quoteIdent("lease_token")} IS NULL AND ${quoteIdent("publication_max_attempts")} IS NOT NULL AND ${quoteIdent("publication_failure_count")} >= ${quoteIdent("publication_max_attempts")}))`,
    ");",
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("consumer_id")} text;`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("consumer_audit_id")} bigint;`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("publication_failure_count")} integer NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("publication_max_attempts")} integer;`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("publication_disposition")} text NOT NULL DEFAULT 'pending';`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("last_publication_error_code")} text;`,
    `ALTER TABLE ${outbox} ADD COLUMN IF NOT EXISTS ${quoteIdent("publication_terminal_at")} timestamptz;`,
    `UPDATE ${outbox} SET ${quoteIdent("publication_disposition")} = 'published' WHERE ${quoteIdent("published_at")} IS NOT NULL AND ${quoteIdent("publication_disposition")} = 'pending';`,
    `ALTER TABLE ${outbox} DROP CONSTRAINT IF EXISTS ${quoteIdent("ck_event_outbox_delivery")};`,
    `ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("ck_event_outbox_delivery")} CHECK (${quoteIdent("delivery_attempts")} >= 0 AND ${quoteIdent("publication_failure_count")} >= 0 AND (${quoteIdent("publication_max_attempts")} IS NULL OR ${quoteIdent("publication_max_attempts")} BETWEEN 1 AND 1000) AND ((${quoteIdent("lease_token")} IS NULL) = (${quoteIdent("leased_until")} IS NULL)));`,
    `ALTER TABLE ${outbox} DROP CONSTRAINT IF EXISTS ${quoteIdent("ck_event_outbox_publication_error")};`,
    `ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("ck_event_outbox_publication_error")} CHECK (${quoteIdent("last_publication_error_code")} IS NULL OR ${quoteIdent("last_publication_error_code")} ~ '^ML_[A-Z_]+$');`,
    `ALTER TABLE ${outbox} DROP CONSTRAINT IF EXISTS ${quoteIdent("ck_event_outbox_publication_disposition")};`,
    `ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("ck_event_outbox_publication_disposition")} CHECK ((` +
      `${quoteIdent("publication_disposition")} = 'pending' AND ${quoteIdent("published_at")} IS NULL AND ${quoteIdent("publication_terminal_at")} IS NULL) OR (` +
      `${quoteIdent("publication_disposition")} = 'published' AND ${quoteIdent("published_at")} IS NOT NULL AND ${quoteIdent("publication_terminal_at")} IS NULL AND ${quoteIdent("lease_token")} IS NULL) OR (` +
      `${quoteIdent("publication_disposition")} = 'deadLetter' AND ${quoteIdent("published_at")} IS NULL AND ${quoteIdent("publication_terminal_at")} IS NOT NULL AND ${quoteIdent("lease_token")} IS NULL AND ${quoteIdent("publication_max_attempts")} IS NOT NULL AND ${quoteIdent("publication_failure_count")} >= ${quoteIdent("publication_max_attempts")}));`,
    `ALTER TABLE ${outbox} ALTER COLUMN ${quoteIdent("action_id")} DROP NOT NULL;`,
    `ALTER TABLE ${outbox} ALTER COLUMN ${quoteIdent("principal_id")} DROP NOT NULL;`,
    `ALTER TABLE ${outbox} ALTER COLUMN ${quoteIdent("action_audit_id")} DROP NOT NULL;`,
    "DO $modellang$",
    "BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '${outbox}'::regclass AND conname = 'fk_event_outbox_consumer_audit') THEN`,
    `    ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("fk_event_outbox_consumer_audit")} FOREIGN KEY (${quoteIdent("consumer_audit_id")}) REFERENCES ${consumerAudit} (${quoteIdent("id")});`,
    "  END IF;",
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '${outbox}'::regclass AND conname = 'uq_event_outbox_consumer_ordinal') THEN`,
    `    ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("uq_event_outbox_consumer_ordinal")} UNIQUE (${quoteIdent("consumer_audit_id")}, ${quoteIdent("ordinal")});`,
    "  END IF;",
    `  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '${outbox}'::regclass AND conname = 'ck_event_outbox_producer') THEN`,
    `    ALTER TABLE ${outbox} ADD CONSTRAINT ${quoteIdent("ck_event_outbox_producer")} CHECK ((` +
      `${quoteIdent("action_id")} IS NOT NULL AND ${quoteIdent("action_id")} ~ '^action:.+$' AND ${quoteIdent("consumer_id")} IS NULL AND ${quoteIdent("action_audit_id")} IS NOT NULL AND ${quoteIdent("consumer_audit_id")} IS NULL AND ${quoteIdent("principal_id")} IS NOT NULL) OR (` +
      `${quoteIdent("action_id")} IS NULL AND ${quoteIdent("consumer_id")} IS NOT NULL AND ${quoteIdent("consumer_id")} ~ '^consumer:.+$' AND ${quoteIdent("action_audit_id")} IS NULL AND ${quoteIdent("consumer_audit_id")} IS NOT NULL AND ${quoteIdent("principal_id")} IS NULL AND ${quoteIdent("command_receipt_id")} IS NULL));`,
    "  END IF;",
    "END",
    "$modellang$;",
    `CREATE INDEX IF NOT EXISTS ${quoteIdent("ix_event_outbox_delivery_v3")} ON ${outbox} (${quoteIdent("occurred_at")}, ${quoteIdent("action_audit_id")}, ${quoteIdent("consumer_audit_id")}, ${quoteIdent("ordinal")}, ${quoteIdent("id")}) WHERE ${quoteIdent("publication_disposition")} = 'pending';`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "claim_events")}(p_limit integer, p_lease_seconds integer)`,
    "RETURNS SETOF jsonb",
    "LANGUAGE plpgsql",
    "SECURITY DEFINER",
    "SET search_path = pg_catalog, pg_temp",
    "AS $modellang$",
    "DECLARE",
    "  v_lease_token uuid := pg_catalog.gen_random_uuid();",
    "BEGIN",
    ...dispatcherCheck,
    "  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600 THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:event_outbox';",
    "  END IF;",
    "  RETURN QUERY",
    "  WITH candidates AS (",
    `    SELECT row_value.${quoteIdent("id")} FROM ${outbox} AS row_value`,
    `    WHERE row_value.${quoteIdent("publication_disposition")} = 'pending' AND (row_value.${quoteIdent("leased_until")} IS NULL OR row_value.${quoteIdent("leased_until")} <= pg_catalog.clock_timestamp())`,
    `    ORDER BY row_value.${quoteIdent("occurred_at")}, (row_value.${quoteIdent("consumer_id")} IS NOT NULL), COALESCE(row_value.${quoteIdent("action_audit_id")}, row_value.${quoteIdent("consumer_audit_id")}), row_value.${quoteIdent("ordinal")}, row_value.${quoteIdent("id")}`,
    "    FOR UPDATE SKIP LOCKED LIMIT p_limit",
    "  ), leased AS (",
    `    UPDATE ${outbox} AS row_value SET ${quoteIdent("lease_token")} = v_lease_token,`,
    `      ${quoteIdent("leased_until")} = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),`,
    `      ${quoteIdent("delivery_attempts")} = row_value.${quoteIdent("delivery_attempts")} + 1`,
    `    FROM candidates WHERE row_value.${quoteIdent("id")} = candidates.${quoteIdent("id")} RETURNING row_value.*`,
    "  )",
    `  SELECT pg_catalog.jsonb_build_object('id', ${quoteIdent("id")}, 'eventId', ${quoteIdent("event_id")}, 'eventName', ${quoteIdent("event_name")},`,
    `    'modelId', ${quoteIdent("model_id")}, 'modelVersion', ${quoteIdent("model_version")}, 'sourceHash', ${quoteIdent("source_hash")}, 'actionId', ${quoteIdent("action_id")}, 'consumerId', ${quoteIdent("consumer_id")},`,
    `    'targetId', ${quoteIdent("target_id")}, 'payload', ${quoteIdent("payload")}, 'correlationId', ${quoteIdent("correlation_id")},`,
    `    'causationId', ${quoteIdent("causation_id")}, 'occurredAt', ${quoteIdent("occurred_at")}, 'ordinal', ${quoteIdent("ordinal")}, 'deliveryAttempt', ${quoteIdent("delivery_attempts")}, 'leaseToken', ${quoteIdent("lease_token")})`,
    `  FROM leased ORDER BY ${quoteIdent("occurred_at")}, (${quoteIdent("consumer_id")} IS NOT NULL), COALESCE(${quoteIdent("action_audit_id")}, ${quoteIdent("consumer_audit_id")}), ${quoteIdent("ordinal")}, ${quoteIdent("id")};`,
    "END",
    "$modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "claim_events")}(integer, integer) FROM PUBLIC;`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "ack_event")}(p_event_id uuid, p_lease_token uuid) RETURNS void`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "BEGIN",
    ...dispatcherCheck,
    `  UPDATE ${outbox} SET ${quoteIdent("publication_disposition")} = 'published', ${quoteIdent("published_at")} = pg_catalog.clock_timestamp(), ${quoteIdent("lease_token")} = (NULL::uuid), ${quoteIdent("leased_until")} = (NULL::timestamptz)`,
    `  WHERE ${quoteIdent("id")} = p_event_id AND ${quoteIdent("publication_disposition")} = 'pending' AND ${quoteIdent("lease_token")} = p_lease_token AND ${quoteIdent("leased_until")} > pg_catalog.clock_timestamp();`,
    "  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "ack_event")}(uuid, uuid) FROM PUBLIC;`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "release_event")}(p_event_id uuid, p_lease_token uuid) RETURNS void`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "BEGIN",
    ...dispatcherCheck,
    `  UPDATE ${outbox} SET ${quoteIdent("lease_token")} = (NULL::uuid), ${quoteIdent("leased_until")} = (NULL::timestamptz)`,
    `  WHERE ${quoteIdent("id")} = p_event_id AND ${quoteIdent("publication_disposition")} = 'pending' AND ${quoteIdent("lease_token")} = p_lease_token AND ${quoteIdent("leased_until")} > pg_catalog.clock_timestamp();`,
    "  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "release_event")}(uuid, uuid) FROM PUBLIC;`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "fail_event")}(p_event_id uuid, p_lease_token uuid, p_error_code text) RETURNS jsonb`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "DECLARE",
    "  v_failure_count integer;",
    "  v_max_attempts integer;",
    "  v_disposition text;",
    "BEGIN",
    ...dispatcherCheck,
    "  IF p_error_code IS NULL OR p_error_code !~ '^ML_[A-Z_]+$' OR pg_catalog.length(p_error_code) > 64 THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:event_outbox';",
    "  END IF;",
    `  UPDATE ${outbox} SET ${quoteIdent("publication_failure_count")} = ${quoteIdent("publication_failure_count")} + 1,`,
    `    ${quoteIdent("last_publication_error_code")} = p_error_code, ${quoteIdent("lease_token")} = (NULL::uuid), ${quoteIdent("leased_until")} = (NULL::timestamptz),`,
    `    ${quoteIdent("publication_disposition")} = CASE WHEN ${quoteIdent("publication_max_attempts")} IS NOT NULL AND ${quoteIdent("publication_failure_count")} + 1 >= ${quoteIdent("publication_max_attempts")} THEN 'deadLetter' ELSE 'pending' END,`,
    `    ${quoteIdent("publication_terminal_at")} = CASE WHEN ${quoteIdent("publication_max_attempts")} IS NOT NULL AND ${quoteIdent("publication_failure_count")} + 1 >= ${quoteIdent("publication_max_attempts")} THEN pg_catalog.clock_timestamp() ELSE (NULL::timestamptz) END`,
    `  WHERE ${quoteIdent("id")} = p_event_id AND ${quoteIdent("publication_disposition")} = 'pending' AND ${quoteIdent("lease_token")} = p_lease_token AND ${quoteIdent("leased_until")} > pg_catalog.clock_timestamp()`,
    `  RETURNING ${quoteIdent("publication_failure_count")}, ${quoteIdent("publication_max_attempts")}, ${quoteIdent("publication_disposition")} INTO v_failure_count, v_max_attempts, v_disposition;`,
    "  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;",
    "  RETURN pg_catalog.jsonb_build_object('status', CASE WHEN v_disposition = 'deadLetter' THEN 'deadLetter' ELSE 'retry' END, 'recorded', TRUE, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "fail_event")}(uuid, uuid, text) FROM PUBLIC;`,
  ];
}

function consumerRoleCheck(): string[] {
  return [
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS consumer_role ON consumer_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE consumer_role.rolname = 'modellang_consumer' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_REQUIRED';",
    "  END IF;",
  ];
}

function recoveryRoleCheck(): string[] {
  return [
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_catalog.pg_auth_members AS membership",
    "    JOIN pg_catalog.pg_roles AS recovery_role ON recovery_role.oid = membership.roleid",
    "    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member",
    "    WHERE recovery_role.rolname = 'modellang_recovery' AND identity_role.rolname = session_user",
    "  ) THEN",
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_RECOVERY_REQUIRED';",
    "  END IF;",
  ];
}

export function generateEventInboxInfrastructureStatements(ir: ModelIR): string[] {
  const internal = ir.model.naming.internalSchema;
  const audit = qname(internal, "consumer_audit");
  const inbox = qname(internal, "event_inbox");
  const failures = qname(internal, "consumer_failure");
  const recoveryAudit = qname(internal, "consumer_recovery_audit");
  const consumerIds = ir.consumers.map((consumer) => `'${consumer.id.replaceAll("'", "''")}'`).join(", ");
  const invalidConsumerIdentity = consumerIds.length > 0 ? `p_consumer_id NOT IN (${consumerIds})` : "TRUE";
  const recoverableConsumerIds = ir.consumers
    .filter((consumer) => consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts" && consumer.failurePolicy.recovery === "manual")
    .map((consumer) => `'${consumer.id.replaceAll("'", "''")}'`).join(", ");
  const invalidRecoverableConsumerIdentity = recoverableConsumerIds.length > 0
    ? `p_consumer_id NOT IN (${recoverableConsumerIds})`
    : "TRUE";
  const maximumByConsumer = ir.consumers.length > 0
    ? `CASE p_consumer_id ${ir.consumers.map((consumer) =>
      `WHEN '${consumer.id.replaceAll("'", "''")}' THEN ${consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts" ? consumer.failurePolicy.maxAttempts : "NULL"}`
    ).join(" ")} ELSE NULL END`
    : "(NULL::integer)";
  return [
    `CREATE TABLE IF NOT EXISTS ${audit} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("consumer_id")} text NOT NULL,`,
    `  ${quoteIdent("source_event_id")} uuid NOT NULL,`,
    `  ${quoteIdent("source_event_type")} text NOT NULL,`,
    `  ${quoteIdent("source_model_id")} text NOT NULL,`,
    `  ${quoteIdent("source_model_version")} text NOT NULL,`,
    `  ${quoteIdent("source_hash")} text NOT NULL,`,
    `  ${quoteIdent("target_id")} uuid,`,
    `  ${quoteIdent("decision_outcome")} text NOT NULL DEFAULT 'executed',`,
    `  ${quoteIdent("authorization_rule_id")} text NOT NULL,`,
    `  ${quoteIdent("policy_id")} text,`,
    `  ${quoteIdent("authority_id")} text,`,
    `  ${quoteIdent("decision_evidence")} jsonb NOT NULL,`,
    `  ${quoteIdent("correlation_id")} text NOT NULL,`,
    `  ${quoteIdent("causation_id")} text,`,
    `  ${quoteIdent("occurred_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),`,
    `  CONSTRAINT ${quoteIdent("uq_consumer_audit_event")} UNIQUE (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_audit_hash")} CHECK (${quoteIdent("source_hash")} ~ '^sha256:[0-9a-f]{64}$'),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_audit_metadata")} CHECK (${quoteIdent("correlation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND (${quoteIdent("causation_id")} IS NULL OR ${quoteIdent("causation_id")} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))`,
    ");",
    `CREATE TABLE IF NOT EXISTS ${inbox} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("consumer_id")} text NOT NULL,`,
    `  ${quoteIdent("source_event_id")} uuid NOT NULL,`,
    `  ${quoteIdent("source_event_type")} text NOT NULL,`,
    `  ${quoteIdent("source_event_name")} text NOT NULL,`,
    `  ${quoteIdent("source_model_id")} text NOT NULL,`,
    `  ${quoteIdent("source_model_version")} text NOT NULL,`,
    `  ${quoteIdent("source_hash")} text NOT NULL,`,
    `  ${quoteIdent("envelope_hash")} text NOT NULL,`,
    `  ${quoteIdent("payload")} jsonb NOT NULL,`,
    `  ${quoteIdent("correlation_id")} text NOT NULL,`,
    `  ${quoteIdent("causation_id")} text,`,
    `  ${quoteIdent("first_delivery_attempt")} integer NOT NULL,`,
    `  ${quoteIdent("last_delivery_attempt")} integer NOT NULL,`,
    `  ${quoteIdent("status")} text NOT NULL DEFAULT 'claimed',`,
    `  ${quoteIdent("target_id")} uuid,`,
    `  ${quoteIdent("response")} jsonb,`,
    `  ${quoteIdent("consumer_audit_id")} bigint REFERENCES ${audit} (${quoteIdent("id")}),`,
    `  ${quoteIdent("claimed_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),`,
    `  ${quoteIdent("completed_at")} timestamptz,`,
    `  CONSTRAINT ${quoteIdent("uq_event_inbox_identity")} UNIQUE (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}),`,
    `  CONSTRAINT ${quoteIdent("ck_event_inbox_hashes")} CHECK (${quoteIdent("source_hash")} ~ '^sha256:[0-9a-f]{64}$' AND ${quoteIdent("envelope_hash")} ~ '^sha256:[0-9a-f]{64}$'),`,
    `  CONSTRAINT ${quoteIdent("ck_event_inbox_attempts")} CHECK (${quoteIdent("first_delivery_attempt")} >= 1 AND ${quoteIdent("last_delivery_attempt")} >= ${quoteIdent("first_delivery_attempt")}),`,
    `  CONSTRAINT ${quoteIdent("ck_event_inbox_status")} CHECK ((${quoteIdent("status")} = 'claimed' AND ${quoteIdent("response")} IS NULL AND ${quoteIdent("completed_at")} IS NULL AND ${quoteIdent("consumer_audit_id")} IS NULL) OR (${quoteIdent("status")} = 'executed' AND ${quoteIdent("response")} IS NOT NULL AND ${quoteIdent("completed_at")} IS NOT NULL AND ${quoteIdent("consumer_audit_id")} IS NOT NULL))`,
    ");",
    `CREATE TABLE IF NOT EXISTS ${failures} (`,
    `  ${quoteIdent("consumer_id")} text NOT NULL,`,
    `  ${quoteIdent("source_event_id")} text NOT NULL,`,
    `  ${quoteIdent("failure_count")} integer NOT NULL DEFAULT 1,`,
    `  ${quoteIdent("total_failure_count")} integer NOT NULL DEFAULT 1,`,
    `  ${quoteIdent("recovery_generation")} integer NOT NULL DEFAULT 0,`,
    `  ${quoteIdent("last_delivery_attempt")} integer NOT NULL,`,
    `  ${quoteIdent("last_error_code")} text NOT NULL,`,
    `  ${quoteIdent("max_attempts")} integer,`,
    `  ${quoteIdent("disposition")} text NOT NULL DEFAULT 'retry',`,
    `  ${quoteIdent("last_failed_at")} timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),`,
    `  ${quoteIdent("terminal_at")} timestamptz,`,
    `  ${quoteIdent("resolved_at")} timestamptz,`,
    `  ${quoteIdent("last_recovered_at")} timestamptz,`,
    `  PRIMARY KEY (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_failure_count")} CHECK (${quoteIdent("failure_count")} >= 0 AND ${quoteIdent("total_failure_count")} >= 1 AND ${quoteIdent("total_failure_count")} >= ${quoteIdent("failure_count")} AND ${quoteIdent("recovery_generation")} >= 0 AND ${quoteIdent("last_delivery_attempt")} >= 1),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_failure_code")} CHECK (${quoteIdent("last_error_code")} ~ '^ML_[A-Z_]+$'),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_failure_disposition")} CHECK (`,
    `    (${quoteIdent("disposition")} = 'ready' AND ${quoteIdent("failure_count")} = 0 AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `    OR (${quoteIdent("disposition")} = 'retry' AND ${quoteIdent("failure_count")} >= 1 AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `    OR (${quoteIdent("disposition")} = 'deadLetter' AND ${quoteIdent("max_attempts")} IS NOT NULL AND ${quoteIdent("failure_count")} >= ${quoteIdent("max_attempts")} AND ${quoteIdent("terminal_at")} IS NOT NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `    OR (${quoteIdent("disposition")} = 'resolved' AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NOT NULL)`,
    "  )",
    ");",
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("total_failure_count")} integer;`,
    `UPDATE ${failures} SET ${quoteIdent("total_failure_count")} = ${quoteIdent("failure_count")} WHERE ${quoteIdent("total_failure_count")} IS NULL;`,
    `ALTER TABLE ${failures} ALTER COLUMN ${quoteIdent("total_failure_count")} SET DEFAULT 1;`,
    `ALTER TABLE ${failures} ALTER COLUMN ${quoteIdent("total_failure_count")} SET NOT NULL;`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("recovery_generation")} integer NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("max_attempts")} integer;`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("disposition")} text NOT NULL DEFAULT 'retry';`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("terminal_at")} timestamptz;`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("resolved_at")} timestamptz;`,
    `ALTER TABLE ${failures} ADD COLUMN IF NOT EXISTS ${quoteIdent("last_recovered_at")} timestamptz;`,
    `ALTER TABLE ${failures} DROP CONSTRAINT IF EXISTS ${quoteIdent("ck_consumer_failure_count")};`,
    `ALTER TABLE ${failures} ADD CONSTRAINT ${quoteIdent("ck_consumer_failure_count")} CHECK (${quoteIdent("failure_count")} >= 0 AND ${quoteIdent("total_failure_count")} >= 1 AND ${quoteIdent("total_failure_count")} >= ${quoteIdent("failure_count")} AND ${quoteIdent("recovery_generation")} >= 0 AND ${quoteIdent("last_delivery_attempt")} >= 1);`,
    `ALTER TABLE ${failures} DROP CONSTRAINT IF EXISTS ${quoteIdent("ck_consumer_failure_disposition")};`,
    `ALTER TABLE ${failures} ADD CONSTRAINT ${quoteIdent("ck_consumer_failure_disposition")} CHECK (`,
    `  (${quoteIdent("disposition")} = 'ready' AND ${quoteIdent("failure_count")} = 0 AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `  OR (${quoteIdent("disposition")} = 'retry' AND ${quoteIdent("failure_count")} >= 1 AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `  OR (${quoteIdent("disposition")} = 'deadLetter' AND ${quoteIdent("max_attempts")} IS NOT NULL AND ${quoteIdent("failure_count")} >= ${quoteIdent("max_attempts")} AND ${quoteIdent("terminal_at")} IS NOT NULL AND ${quoteIdent("resolved_at")} IS NULL)`,
    `  OR (${quoteIdent("disposition")} = 'resolved' AND ${quoteIdent("terminal_at")} IS NULL AND ${quoteIdent("resolved_at")} IS NOT NULL)`,
    ");",
    `CREATE TABLE IF NOT EXISTS ${recoveryAudit} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("consumer_id")} text NOT NULL,`,
    `  ${quoteIdent("source_event_id")} text NOT NULL,`,
    `  ${quoteIdent("recovery_generation")} integer NOT NULL,`,
    `  ${quoteIdent("prior_failure_count")} integer NOT NULL,`,
    `  ${quoteIdent("total_failure_count")} integer NOT NULL,`,
    `  ${quoteIdent("prior_error_code")} text NOT NULL,`,
    `  ${quoteIdent("reason_code")} text NOT NULL,`,
    `  ${quoteIdent("database_principal")} name NOT NULL,`,
    `  ${quoteIdent("occurred_at")} timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),`,
    `  CONSTRAINT ${quoteIdent("uq_consumer_recovery_generation")} UNIQUE (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}, ${quoteIdent("recovery_generation")}),`,
    `  CONSTRAINT ${quoteIdent("fk_consumer_recovery_failure")} FOREIGN KEY (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}) REFERENCES ${failures} (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_recovery_counts")} CHECK (${quoteIdent("recovery_generation")} >= 1 AND ${quoteIdent("prior_failure_count")} >= 1 AND ${quoteIdent("total_failure_count")} >= ${quoteIdent("prior_failure_count")}),`,
    `  CONSTRAINT ${quoteIdent("ck_consumer_recovery_codes")} CHECK (${quoteIdent("prior_error_code")} ~ '^ML_[A-Z_]+$' AND ${quoteIdent("reason_code")} ~ '^[A-Z][A-Z0-9_]{0,63}$')`,
    ");",
    `CREATE OR REPLACE FUNCTION ${qname(internal, "consumer_failure_state")}(p_consumer_id text, p_event_id text) RETURNS jsonb`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "DECLARE",
    "  v_max_attempts integer;",
    "  v_failure_count integer;",
    "  v_error_code text;",
    "  v_disposition text;",
    "BEGIN",
    ...consumerRoleCheck(),
    `  IF p_consumer_id IS NULL OR ${invalidConsumerIdentity} OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$' THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END IF;",
    "  p_event_id := p_event_id::uuid::text;",
    `  v_max_attempts := ${maximumByConsumer};`,
    `  SELECT ${quoteIdent("failure_count")}, ${quoteIdent("last_error_code")}, ${quoteIdent("disposition")} INTO v_failure_count, v_error_code, v_disposition`,
    `  FROM ${failures} WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id FOR UPDATE;`,
    "  IF NOT FOUND OR v_disposition IN ('ready', 'resolved') THEN RETURN pg_catalog.jsonb_build_object('status', 'ready'); END IF;",
    "  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;",
    `  UPDATE ${failures} SET ${quoteIdent("max_attempts")} = v_max_attempts, ${quoteIdent("disposition")} = v_disposition,`,
    `    ${quoteIdent("terminal_at")} = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE(${quoteIdent("terminal_at")}, pg_catalog.clock_timestamp()) ELSE NULL END, ${quoteIdent("resolved_at")} = (NULL::timestamptz)`,
    `  WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id;`,
    "  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', v_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "consumer_failure_state")}(text, text) FROM PUBLIC;`,
    `DROP FUNCTION IF EXISTS ${qname(internal, "record_consumer_failure")}(text, text, integer, text);`,
    `CREATE FUNCTION ${qname(internal, "record_consumer_failure")}(p_consumer_id text, p_event_id text, p_delivery_attempt integer, p_error_code text) RETURNS jsonb`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "DECLARE",
    "  v_max_attempts integer;",
    "  v_failure_count integer;",
    "  v_disposition text;",
    "BEGIN",
    ...consumerRoleCheck(),
    `  IF p_consumer_id IS NULL OR ${invalidConsumerIdentity} OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'`,
    "     OR p_delivery_attempt IS NULL OR p_delivery_attempt < 1 OR p_error_code IS NULL OR p_error_code !~ '^ML_[A-Z_]+$' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END IF;",
    "  p_event_id := p_event_id::uuid::text;",
    "  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));",
    `  v_max_attempts := ${maximumByConsumer};`,
    `  IF EXISTS (SELECT 1 FROM ${inbox} WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id::uuid AND ${quoteIdent("status")} = 'executed') THEN`,
    `    UPDATE ${failures} SET ${quoteIdent("disposition")} = 'resolved', ${quoteIdent("max_attempts")} = v_max_attempts, ${quoteIdent("terminal_at")} = (NULL::timestamptz), ${quoteIdent("resolved_at")} = COALESCE(${quoteIdent("resolved_at")}, pg_catalog.clock_timestamp())`,
    `    WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id;`,
    "    RETURN pg_catalog.jsonb_build_object('status', 'ignoredCommitted', 'recorded', FALSE, 'errorCode', p_error_code, 'failureCount', NULL, 'maxAttempts', v_max_attempts);",
    "  END IF;",
    `  SELECT ${quoteIdent("failure_count")}, ${quoteIdent("disposition")} INTO v_failure_count, v_disposition FROM ${failures}`,
    `  WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id FOR UPDATE;`,
    "  IF FOUND AND v_disposition = 'deadLetter' THEN",
    "    RETURN pg_catalog.jsonb_build_object('status', 'deadLetter', 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);",
    "  END IF;",
    `  INSERT INTO ${failures} AS failure_row (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}, ${quoteIdent("failure_count")}, ${quoteIdent("total_failure_count")}, ${quoteIdent("last_delivery_attempt")}, ${quoteIdent("last_error_code")}, ${quoteIdent("max_attempts")}, ${quoteIdent("disposition")}, ${quoteIdent("terminal_at")})`,
    "  VALUES (p_consumer_id, p_event_id, 1, 1, p_delivery_attempt, p_error_code, v_max_attempts, 'retry', NULL)",
    `  ON CONFLICT (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}) DO UPDATE SET`,
    `    ${quoteIdent("failure_count")} = failure_row.${quoteIdent("failure_count")} + 1, ${quoteIdent("total_failure_count")} = failure_row.${quoteIdent("total_failure_count")} + 1, ${quoteIdent("last_delivery_attempt")} = GREATEST(failure_row.${quoteIdent("last_delivery_attempt")}, EXCLUDED.${quoteIdent("last_delivery_attempt")}),`,
    `    ${quoteIdent("last_error_code")} = EXCLUDED.${quoteIdent("last_error_code")}, ${quoteIdent("max_attempts")} = v_max_attempts,`,
    `    ${quoteIdent("disposition")} = 'retry', ${quoteIdent("last_failed_at")} = pg_catalog.clock_timestamp(), ${quoteIdent("terminal_at")} = (NULL::timestamptz), ${quoteIdent("resolved_at")} = (NULL::timestamptz)`,
    `  RETURNING ${quoteIdent("failure_count")} INTO v_failure_count;`,
    "  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;",
    `  UPDATE ${failures} SET ${quoteIdent("max_attempts")} = v_max_attempts, ${quoteIdent("disposition")} = v_disposition,`,
    `    ${quoteIdent("terminal_at")} = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE(${quoteIdent("terminal_at")}, pg_catalog.clock_timestamp()) ELSE NULL END, ${quoteIdent("resolved_at")} = (NULL::timestamptz)`,
    `  WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id;`,
    "  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "record_consumer_failure")}(text, text, integer, text) FROM PUBLIC;`,
    `CREATE OR REPLACE FUNCTION ${qname(internal, "recover_consumer_failure")}(p_consumer_id text, p_event_id text, p_reason_code text) RETURNS jsonb`,
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$",
    "DECLARE",
    "  v_failure_count integer;",
    "  v_total_failure_count integer;",
    "  v_error_code text;",
    "  v_disposition text;",
    "  v_recovery_generation integer;",
    "BEGIN",
    ...recoveryRoleCheck(),
    `  IF p_consumer_id IS NULL OR ${invalidRecoverableConsumerIdentity} OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'`,
    "     OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_CONSUMER_RECOVERY';",
    "  END IF;",
    "  p_event_id := p_event_id::uuid::text;",
    "  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));",
    `  IF EXISTS (SELECT 1 FROM ${inbox} WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id::uuid AND ${quoteIdent("status")} = 'executed') THEN`,
    "    RETURN pg_catalog.jsonb_build_object('status', 'alreadyConsumed', 'recovered', FALSE);",
    "  END IF;",
    `  SELECT ${quoteIdent("failure_count")}, ${quoteIdent("total_failure_count")}, ${quoteIdent("last_error_code")}, ${quoteIdent("disposition")}, ${quoteIdent("recovery_generation")}`,
    "  INTO v_failure_count, v_total_failure_count, v_error_code, v_disposition, v_recovery_generation",
    `  FROM ${failures} WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id FOR UPDATE;`,
    "  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_RECOVERY_STATE';",
    "  END IF;",
    "  v_recovery_generation := v_recovery_generation + 1;",
    `  UPDATE ${failures} SET ${quoteIdent("failure_count")} = 0, ${quoteIdent("disposition")} = 'ready',`,
    `    ${quoteIdent("recovery_generation")} = v_recovery_generation, ${quoteIdent("terminal_at")} = (NULL::timestamptz),`,
    `    ${quoteIdent("resolved_at")} = (NULL::timestamptz), ${quoteIdent("last_recovered_at")} = pg_catalog.clock_timestamp()`,
    `  WHERE ${quoteIdent("consumer_id")} = p_consumer_id AND ${quoteIdent("source_event_id")} = p_event_id;`,
    `  INSERT INTO ${recoveryAudit} (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}, ${quoteIdent("recovery_generation")}, ${quoteIdent("prior_failure_count")}, ${quoteIdent("total_failure_count")}, ${quoteIdent("prior_error_code")}, ${quoteIdent("reason_code")}, ${quoteIdent("database_principal")})`,
    "  VALUES (p_consumer_id, p_event_id, v_recovery_generation, v_failure_count, v_total_failure_count, v_error_code, p_reason_code, session_user);",
    "  RETURN pg_catalog.jsonb_build_object('status', 'recovered', 'recovered', TRUE, 'recoveryGeneration', v_recovery_generation, 'priorFailureCount', v_failure_count, 'totalFailureCount', v_total_failure_count);",
    "END $modellang$;",
    `REVOKE ALL ON FUNCTION ${qname(internal, "recover_consumer_failure")}(text, text, text) FROM PUBLIC;`,
  ];
}

function generateSchema(ir: ModelIR): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const lines = [
    `-- source ${ir.model.sourceHash}`,
    ...(ir.entities.some((entity) => entity.temporalExclusions.length > 0)
      ? ["CREATE EXTENSION IF NOT EXISTS btree_gist;", ""]
      : []),
    `CREATE SCHEMA ${quoteIdent(schema)} AUTHORIZATION modellang_owner;`,
    `CREATE SCHEMA ${quoteIdent(internal)} AUTHORIZATION modellang_owner;`,
    "SET ROLE modellang_owner;",
    `REVOKE ALL ON SCHEMA ${quoteIdent(schema)} FROM PUBLIC;`,
    `REVOKE ALL ON SCHEMA ${quoteIdent(internal)} FROM PUBLIC;`,
    "",
  ];
  for (const entity of ir.entities) {
    lines.push(generateEntityTableStatement(ir, entity), "");
  }
  for (const entity of ir.entities) {
    for (const statement of generateEntityForeignKeyStatements(ir, entity)) lines.push(statement, "");
  }
  for (const workflow of ir.workflows) {
    for (const statement of generateWorkflowStatements(ir, workflow, true)) lines.push(statement, "");
  }
  const principal = entityById(ir, ir.principal.entityId);
  lines.push(
    `CREATE TABLE ${qname(internal, "principal_binding")} (`,
    `  ${quoteIdent("database_principal")} name PRIMARY KEY,`,
    `  ${quoteIdent("principal_id")} uuid NOT NULL UNIQUE REFERENCES ${qname(schema, principal.naming.sqlTable)} (${quoteIdent("id")})`,
    ");",
    "",
    `CREATE TABLE ${qname(internal, "action_audit")} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("action_id")} text NOT NULL,`,
    `  ${quoteIdent("database_principal")} name NOT NULL,`,
    `  ${quoteIdent("principal_id")} uuid NOT NULL,`,
    `  ${quoteIdent("target_id")} uuid,`,
    `  ${quoteIdent("occurred_at")} timestamptz NOT NULL DEFAULT transaction_timestamp()`,
    ");",
    "",
    ...generateGatewayInfrastructureStatements(ir),
    ...generateDecisionEvidenceInfrastructureStatements(ir),
    ...generateCommandReceiptInfrastructureStatements(ir),
    ...generateEventInboxInfrastructureStatements(ir),
    ...generateEventOutboxInfrastructureStatements(ir),
    "",
    `CREATE TABLE ${qname(internal, "schema_migrations")} (`,
    `  ${quoteIdent("id")} bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,`,
    `  ${quoteIdent("model_id")} text NOT NULL,`,
    `  ${quoteIdent("version")} text NOT NULL UNIQUE,`,
    `  ${quoteIdent("source_hash")} text NOT NULL UNIQUE,`,
    `  ${quoteIdent("migration_kind")} text NOT NULL,`,
    `  ${quoteIdent("plan_hash")} text,`,
    `  CONSTRAINT ${quoteIdent("ck_schema_migrations_kind")} CHECK (${quoteIdent("migration_kind")} IN ('installation', 'safe', 'reviewed')),`,
    `  CONSTRAINT ${quoteIdent("ck_schema_migrations_reviewed_plan")} CHECK (`,
    `    ((${quoteIdent("migration_kind")} = 'reviewed') = (${quoteIdent("plan_hash")} IS NOT NULL))`,
    `    AND (${quoteIdent("plan_hash")} IS NULL OR ${quoteIdent("plan_hash")} ~ '^sha256:[0-9a-f]{64}$')`,
    "  ),",
    `  ${quoteIdent("applied_at")} timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()`,
    ");",
    `INSERT INTO ${qname(internal, "schema_migrations")} (${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}, ${quoteIdent("migration_kind")})`,
    `VALUES ('${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', 'installation');`,
    "RESET ROLE;",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function parameterSql(parameter: IRParameter): string {
  return `${quoteIdent(parameter.naming.sqlParameter)} ${sqlType(parameter.type)}`;
}

function functionSignature(ir: ModelIR, operation: IRAction | IRQuery): string {
  const callable = operation.parameters.filter((parameter) => operation.callableParameters.includes(parameter.id));
  return `${qname(ir.model.naming.sqlSchema, operation.naming.sqlFunction)}(${callable.map((parameter) => sqlType(parameter.type)).join(", ")})`;
}

function decisionFunctionSignature(ir: ModelIR, action: IRAction): string {
  const callable = action.parameters.filter((parameter) => action.callableParameters.includes(parameter.id));
  return `${qname(ir.model.naming.sqlSchema, decisionFunctionName(action.id))}(${[...callable.map((parameter) => sqlType(parameter.type)), "text"].join(", ")})`;
}

function revisionInputSql(parameter: IRParameter, value: string): string {
  if (parameter.type.startsWith("set:enum:")) {
    return `pg_catalog.to_jsonb(ARRAY(SELECT member FROM pg_catalog.unnest(${value}) AS member ORDER BY member))`;
  }
  if (isMoneyType(parameter.type)) {
    const profile = moneyProfileFromType(parameter.type)!;
    return `pg_catalog.to_jsonb((${value})::numeric(${profile.precision}, ${profile.scale}))`;
  }
  if (parameter.type === "Decimal") {
    return `pg_catalog.to_jsonb(pg_catalog.trim_scale(${value}))`;
  }
  return `pg_catalog.to_jsonb(${value})`;
}

function revisionExpression(
  ir: ModelIR,
  action: IRAction,
  decision: ActionDecisionPlan,
  xminNames: Map<string, string>,
): string {
  const components = decision.revision.componentParameterIds.map((parameterId) => {
    const parameter = action.parameters.find((candidate) => candidate.id === parameterId)!;
    const value = parameter.caller ? "v_principal_id" : quoteIdent(parameter.naming.sqlParameter);
    const pairs = [
      `'parameterId', '${parameter.id.replaceAll("'", "''")}'`,
      `'value', ${revisionInputSql(parameter, value)}`,
    ];
    const xmin = xminNames.get(parameter.id);
    if (xmin) pairs.push(`'rowVersion', pg_catalog.to_jsonb(${xmin})`);
    return `pg_catalog.jsonb_build_object(${pairs.join(", ")})`;
  });
  return `'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object(`
    + `'sourceHash', '${ir.model.sourceHash.replaceAll("'", "''")}', `
    + `'operationId', '${action.id.replaceAll("'", "''")}', `
    + `'components', pg_catalog.jsonb_build_array(${components.join(", ")})`
    + `)::text)`;
}

function decisionJson(
  action: IRAction,
  status: "applicable" | "denied" | "notApplicable" | "stale",
  revision: string | undefined,
  explanation: { kind: "authorization" | "requirement" | "revision"; ruleId: string } | undefined,
): string {
  const values = [
    `'operationId', '${action.id.replaceAll("'", "''")}'`,
    `'status', '${status}'`,
    `'applicable', ${status === "applicable" ? "TRUE" : "FALSE"}`,
    `'authority', 'none'`,
  ];
  if (revision) values.push(`'revision', ${revision}`);
  if (explanation) {
    values.push(`'explanation', pg_catalog.jsonb_build_object('kind', '${explanation.kind}', 'ruleId', '${explanation.ruleId.replaceAll("'", "''")}')`);
  }
  return `pg_catalog.jsonb_build_object(${values.join(", ")})`;
}

function rowJson(entity: IREntity, record: string): string {
  const values = entity.fields.flatMap((field) => {
    const column = `${record}.${quoteIdent(field.naming.sqlColumn)}`;
    let value = `${column}${field.type === "Decimal" ? "::text" : ""}`;
    if (isMoneyType(field.type)) {
      const profile = moneyProfileFromType(field.type)!;
      const encoded = `jsonb_build_object('currency', '${profile.currency}', 'amount', (${column}::numeric(${profile.precision}, ${profile.scale}))::text)`;
      value = field.optional ? `CASE WHEN ${column} IS NULL THEN NULL ELSE ${encoded} END` : encoded;
    }
    return [`'${field.name.replaceAll("'", "''")}'`, value];
  });
  return `jsonb_build_object(${values.join(", ")})`;
}

function moneyParameterValidation(parameter: IRParameter): string[] {
  const profile = moneyProfileFromType(parameter.type)!;
  const value = quoteIdent(parameter.naming.sqlParameter);
  const ruleId = `money-parameter:${parameter.id}`;
  return [
    `  IF NOT ((${value} <> 'NaN'::numeric AND pg_catalog.scale(${value}) <= ${profile.scale} AND pg_catalog.abs(${value}) < ${moneyMagnitudeLimit(profile)}) IS TRUE) THEN`,
    `    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:${ruleId}';`,
    "  END IF;",
    "",
  ];
}

function decisionEvidenceSql(ir: ModelIR, action: IRAction, decision: ActionDecisionPlan): string {
  const requirements = decision.preconditions.map((rule) =>
    `pg_catalog.jsonb_build_object('ruleId', '${rule.id.replaceAll("'", "''")}', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array(${rule.policyIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(", ")}))`);
  return `pg_catalog.jsonb_build_object(`
    + `'version', 2, 'outcome', 'executed', `
    + `'model', pg_catalog.jsonb_build_object('id', '${ir.model.id.replaceAll("'", "''")}', 'version', '${ir.model.version.replaceAll("'", "''")}', 'sourceHash', '${ir.model.sourceHash.replaceAll("'", "''")}'), `
    + `'actionId', '${action.id.replaceAll("'", "''")}', `
    + `'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), `
    + `'authorization', pg_catalog.jsonb_build_object('ruleId', '${decision.authorization.id.replaceAll("'", "''")}', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), `
    + `'requirements', pg_catalog.jsonb_build_array(${requirements.join(", ")}))`;
}

function commandRequestJsonSql(action: IRAction, callable: IRParameter[]): string {
  const inputs = callable.flatMap((parameter) => [
    `'${parameter.id.replaceAll("'", "''")}'`,
    revisionInputSql(parameter, quoteIdent(parameter.naming.sqlParameter)),
  ]);
  return `pg_catalog.jsonb_build_object(`
    + `'actionId', '${action.id.replaceAll("'", "''")}', `
    + `'inputs', pg_catalog.jsonb_build_object(${inputs.join(", ")}), `
    + `'expectedRevision', v_expected_revision, `
    + `'correlationId', v_correlation_id, `
    + `'causationId', v_causation_id)`;
}

function commandRequestHashSql(action: IRAction, callable: IRParameter[]): string {
  return `'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((${commandRequestJsonSql(action, callable)})::text, 'UTF8')), 'hex')`;
}

function generateAction(ir: ModelIR, action: IRAction, decision: ActionDecisionPlan): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const callable = action.parameters.filter((parameter) => action.callableParameters.includes(parameter.id));
  const recordNames = new Map<string, string>();
  const xminNames = new Map<string, string>();
  for (const parameter of action.parameters.filter((candidate) => candidate.type.startsWith("entity:"))) {
    recordNames.set(parameter.id, `v_${snakeCase(parameter.name)}`);
    xminNames.set(parameter.id, `v_${snakeCase(parameter.name)}_xmin`);
  }
  const returnEntity = entityById(ir, action.returnEntityId);
  const declarations = [
    "  v_principal_id uuid;",
    "  v_identity_issuer text;",
    "  v_identity_subject text;",
    "  v_revision text;",
    "  v_expected_revision text;",
    "  v_idempotency_key text;",
    "  v_correlation_id text;",
    "  v_causation_id text;",
    "  v_request_hash text;",
    "  v_receipt_source_hash text;",
    "  v_receipt_request_hash text;",
    "  v_receipt_status text;",
    "  v_receipt_id bigint;",
    "  v_action_audit_id bigint;",
    "  v_receipt_response jsonb;",
    "  v_response jsonb;",
    "  v_authority_policy_id text;",
    "  v_authority_id text;",
    `  v_result ${qname(schema, returnEntity.naming.sqlTable)}%ROWTYPE;`,
  ];
  for (const parameter of action.parameters.filter((candidate) => candidate.type.startsWith("entity:"))) {
    const entity = entityById(ir, parameter.type);
    declarations.push(`  ${recordNames.get(parameter.id)} ${qname(schema, entity.naming.sqlTable)}%ROWTYPE;`);
    declarations.push(`  ${xminNames.get(parameter.id)} text;`);
  }
  const body: string[] = [
    `  SELECT identity.${quoteIdent("principal_id")}, identity.${quoteIdent("identity_issuer")}, identity.${quoteIdent("identity_subject")}`,
    "  INTO v_principal_id, v_identity_issuer, v_identity_subject",
    `  FROM ${qname(internal, "resolve_principal")}() AS identity;`,
    "",
    `  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');`,
    `  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');`,
    `  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');`,
    `  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');`,
    `  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);`,
    `  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);`,
    `  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);`,
    `  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);`,
    "",
  ];
  if (action.idempotency) {
    body.push(
      "  IF v_idempotency_key IS NULL THEN",
      `    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_REQUIRED:idempotency:${action.id}';`,
      "  END IF;",
      "  v_correlation_id := COALESCE(v_correlation_id, v_idempotency_key);",
      "",
    );
  } else {
    body.push(
      "  IF v_idempotency_key IS NOT NULL THEN",
      `    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_UNSUPPORTED:idempotency:${action.id}';`,
      "  END IF;",
      "  v_correlation_id := COALESCE(v_correlation_id, pg_catalog.gen_random_uuid()::text);",
      "",
    );
  }
  body.push(
    "  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
    "     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')",
    ...(action.idempotency ? ["     OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'"] : []),
    "  THEN",
    `    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:${action.id}';`,
    "  END IF;",
    "",
  );
  for (const parameter of callable.filter((candidate) => isMoneyType(candidate.type))) {
    body.push(...moneyParameterValidation(parameter));
  }
  if (action.idempotency) {
    body.push(
      `  v_request_hash := ${commandRequestHashSql(action, callable)};`,
      `  INSERT INTO ${qname(internal, "command_receipt")} (${quoteIdent("model_id")}, ${quoteIdent("model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("action_id")}, ${quoteIdent("principal_id")}, ${quoteIdent("idempotency_key")}, ${quoteIdent("request_hash")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")})`,
      `  VALUES ('${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', '${action.id.replaceAll("'", "''")}', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)`,
      `  ON CONFLICT (${quoteIdent("principal_id")}, ${quoteIdent("action_id")}, ${quoteIdent("idempotency_key")}) DO NOTHING`,
      `  RETURNING ${quoteIdent("id")} INTO v_receipt_id;`,
      "",
      "  IF v_receipt_id IS NULL THEN",
      `    SELECT ${quoteIdent("id")}, ${quoteIdent("source_hash")}, ${quoteIdent("request_hash")}, ${quoteIdent("status")}, ${quoteIdent("response")}`,
      "    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response",
      `    FROM ${qname(internal, "command_receipt")}`,
      `    WHERE ${quoteIdent("principal_id")} = v_principal_id AND ${quoteIdent("action_id")} = '${action.id.replaceAll("'", "''")}' AND ${quoteIdent("idempotency_key")} = v_idempotency_key;`,
      `    IF v_receipt_source_hash IS DISTINCT FROM '${ir.model.sourceHash.replaceAll("'", "''")}' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN`,
      `      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_IDEMPOTENCY_CONFLICT:idempotency:${action.id}';`,
      "    END IF;",
      "    IF v_receipt_status IS DISTINCT FROM 'executed' OR v_receipt_response IS NULL THEN",
      `      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_IDEMPOTENCY_INCOMPLETE:idempotency:${action.id}';`,
      "    END IF;",
      "    RETURN v_receipt_response;",
      "  END IF;",
      "",
    );
  }
  const lockGroups = new Map<string, typeof decision.entityLoads>();
  for (const load of decision.entityLoads) {
    const group = lockGroups.get(load.entityId) ?? [];
    group.push(load);
    lockGroups.set(load.entityId, group);
  }
  for (const [entityId, locks] of lockGroups) {
    const entity = entityById(ir, entityId);
    const mode = locks.some((lock) => lock.executionLock === "update") ? "UPDATE" : "SHARE";
    const ids = locks.map((lock) => {
      const parameter = action.parameters.find((candidate) => candidate.id === lock.parameterId)!;
      return parameter.caller ? "v_principal_id" : quoteIdent(parameter.naming.sqlParameter);
    });
    body.push(
      `  PERFORM ${quoteIdent("id")} FROM ${qname(schema, entity.naming.sqlTable)}`,
      `  WHERE ${quoteIdent("id")} = ANY (ARRAY[${ids.join(", ")}]::uuid[])`,
      `  ORDER BY ${quoteIdent("id")} FOR ${mode};`,
      "",
    );
  }
  for (const load of decision.entityLoads) {
    const parameter = action.parameters.find((candidate) => candidate.id === load.parameterId)!;
    const entity = entityById(ir, parameter.type);
    const idValue = parameter.caller ? "v_principal_id" : quoteIdent(parameter.naming.sqlParameter);
    body.push(
      `  SELECT * INTO ${recordNames.get(parameter.id)}`,
      `  FROM ${qname(schema, entity.naming.sqlTable)} AS row_value`,
      `  WHERE row_value.${quoteIdent("id")} = ${idValue}`,
      ";",
      "",
      "  IF NOT FOUND THEN",
      `    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:${decision.absenceProjection.explanationRuleId}';`,
      "  END IF;",
      "",
      `  SELECT row_value.xmin::text INTO ${xminNames.get(parameter.id)}`,
      `  FROM ${qname(schema, entity.naming.sqlTable)} AS row_value`,
      `  WHERE row_value.${quoteIdent("id")} = ${idValue};`,
      "",
    );
  }
  const context = { ir, action, recordNames };
  body.push(
    `  v_revision := ${revisionExpression(ir, action, decision, xminNames)};`,
    "",
    `  IF NOT ((${lowerExpression(decision.authorization.expression, context)}) IS TRUE) THEN`,
    `    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:${decision.authorization.id}';`,
    "  END IF;",
    "",
    "  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN",
    `    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:${decision.revision.ruleId}';`,
    "  END IF;",
    "",
  );
  const authorityCall = authorityPolicyCall(decision.authorization.expression);
  if (decision.authorityPolicyId) {
    if (!authorityCall || authorityCall.policyId !== decision.authorityPolicyId) throw new Error(`E4012 Missing exact authority policy for ${action.id}`);
    body.push(
      `  v_authority_policy_id := '${decision.authorityPolicyId.replaceAll("'", "''")}';`,
      `  v_authority_id := ${policyAuthorityBranchSql(authorityCall, context)};`,
      "",
    );
  }
  for (const precondition of decision.preconditions) {
    body.push(
      `  IF NOT ((${lowerExpression(precondition.expression, context)}) IS TRUE) THEN`,
      `    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:${precondition.id}';`,
      "  END IF;",
      "",
    );
  }
  const effectEntity = entityById(ir, action.effect.entityId);
  if (action.effect.kind === "create") {
    const fields = action.effect.assignments.map((assignment) => fieldById(ir, assignment.fieldId).field);
    if (fields.length === 0) {
      body.push(
        `  INSERT INTO ${qname(schema, effectEntity.naming.sqlTable)} DEFAULT VALUES`,
        "  RETURNING * INTO v_result;",
        "",
      );
    } else {
      body.push(
        `  INSERT INTO ${qname(schema, effectEntity.naming.sqlTable)} (${fields.map((field) => quoteIdent(field.naming.sqlColumn)).join(", ")})`,
        `  VALUES (${action.effect.assignments.map((assignment) => lowerExpression(assignment.expression, context)).join(", ")})`,
        "  RETURNING * INTO v_result;",
        "",
      );
    }
  } else {
    const targetParameter = action.parameters.find((parameter) => parameter.name === action.effect.target)!;
    body.push(
      `  UPDATE ${qname(schema, effectEntity.naming.sqlTable)}`,
      `  SET ${action.effect.assignments.map((assignment) => {
        const field = fieldById(ir, assignment.fieldId).field;
        return `${quoteIdent(field.naming.sqlColumn)} = ${lowerExpression(assignment.expression, context)}`;
      }).join(",\n      ")}`,
      `  WHERE ${quoteIdent("id")} = ${recordNames.get(targetParameter.id)}.${quoteIdent("id")}`,
      "  RETURNING * INTO v_result;",
      "",
    );
  }
  body.push(
    `  v_response := ${rowJson(returnEntity, "v_result")};`,
    `  INSERT INTO ${qname(internal, "action_audit")} (${quoteIdent("action_id")}, ${quoteIdent("database_principal")}, ${quoteIdent("principal_id")}, ${quoteIdent("target_id")}, ${quoteIdent("identity_issuer")}, ${quoteIdent("identity_subject")}, ${quoteIdent("model_id")}, ${quoteIdent("model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("authorization_rule_id")}, ${quoteIdent("decision_outcome")}, ${quoteIdent("policy_id")}, ${quoteIdent("authority_id")}, ${quoteIdent("decision_evidence")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")}, ${quoteIdent("command_receipt_id")})`,
    `  VALUES ('${action.id}', session_user, v_principal_id, v_result.${quoteIdent("id")}, v_identity_issuer, v_identity_subject, '${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', '${decision.authorization.id.replaceAll("'", "''")}', 'executed', v_authority_policy_id, v_authority_id, ${decisionEvidenceSql(ir, action, decision)}, v_correlation_id, v_causation_id, v_receipt_id)`,
    `  RETURNING ${quoteIdent("id")} INTO v_action_audit_id;`,
    "",
  );
  action.emittedEventIds.forEach((emittedEventId, ordinal) => {
    const event = ir.events.find((candidate) => candidate.id === emittedEventId);
    if (!event) throw new Error(`E4013 Missing emitted event ${emittedEventId}`);
    body.push(
      `  INSERT INTO ${qname(internal, "event_outbox")} (${quoteIdent("model_id")}, ${quoteIdent("model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("event_id")}, ${quoteIdent("event_name")}, ${quoteIdent("payload_entity_id")}, ${quoteIdent("action_id")}, ${quoteIdent("principal_id")}, ${quoteIdent("target_id")}, ${quoteIdent("payload")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")}, ${quoteIdent("action_audit_id")}, ${quoteIdent("command_receipt_id")}, ${quoteIdent("ordinal")}, ${quoteIdent("publication_max_attempts")})`,
      `  VALUES ('${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', '${event.id.replaceAll("'", "''")}', '${event.name.replaceAll("'", "''")}', '${event.payloadEntityId.replaceAll("'", "''")}', '${action.id.replaceAll("'", "''")}', v_principal_id, v_result.${quoteIdent("id")}, v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, ${ordinal}, ${event.publicationFailurePolicy.mode === "deadLetterAfterMaxAttempts" ? event.publicationFailurePolicy.maxAttempts : "(NULL::integer)"});`,
      "",
    );
  });
  if (action.idempotency) {
    body.push(
      `  UPDATE ${qname(internal, "command_receipt")}`,
      `  SET ${quoteIdent("status")} = 'executed', ${quoteIdent("response")} = v_response, ${quoteIdent("target_id")} = v_result.${quoteIdent("id")},`,
      `      ${quoteIdent("action_audit_id")} = v_action_audit_id, ${quoteIdent("completed_at")} = pg_catalog.transaction_timestamp()`,
      `  WHERE ${quoteIdent("id")} = v_receipt_id;`,
      "",
    );
  }
  body.push("  RETURN v_response;");
  return `CREATE OR REPLACE FUNCTION ${qname(schema, action.naming.sqlFunction)}(${callable.map(parameterSql).join(", ")})
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
${declarations.join("\n")}
BEGIN
${body.join("\n")}
END
$modellang$;

REVOKE ALL ON FUNCTION ${functionSignature(ir, action)} FROM PUBLIC;
`;
}

function generateActions(ir: ModelIR, plan: DecisionPlan): string {
  return `-- Generated guarded action functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

${ir.actions.map((action) => generateAction(ir, action, decisionAction(plan, action.id))).join("\n")}
RESET ROLE;
`;
}

function generateDecision(ir: ModelIR, action: IRAction, decision: ActionDecisionPlan): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const callable = action.parameters.filter((parameter) => action.callableParameters.includes(parameter.id));
  const recordNames = new Map<string, string>();
  const xminNames = new Map<string, string>();
  const declarations = ["  v_principal_id uuid;", "  v_revision text;"];
  for (const load of decision.entityLoads) {
    const parameter = action.parameters.find((candidate) => candidate.id === load.parameterId)!;
    const entity = entityById(ir, load.entityId);
    const record = `v_${snakeCase(parameter.name)}`;
    const xmin = `${record}_xmin`;
    recordNames.set(parameter.id, record);
    xminNames.set(parameter.id, xmin);
    declarations.push(`  ${record} ${qname(schema, entity.naming.sqlTable)}%ROWTYPE;`, `  ${xmin} text;`);
  }
  const body = [
    `  SELECT identity.${quoteIdent("principal_id")} INTO v_principal_id`,
    `  FROM ${qname(internal, "resolve_principal_snapshot")}() AS identity;`,
    "",
  ];
  for (const parameter of callable.filter((candidate) => isMoneyType(candidate.type))) {
    body.push(...moneyParameterValidation(parameter));
  }
  for (const load of decision.entityLoads) {
    const parameter = action.parameters.find((candidate) => candidate.id === load.parameterId)!;
    const entity = entityById(ir, load.entityId);
    const idValue = parameter.caller ? "v_principal_id" : quoteIdent(parameter.naming.sqlParameter);
    body.push(
      `  SELECT * INTO ${recordNames.get(parameter.id)}`,
      `  FROM ${qname(schema, entity.naming.sqlTable)} AS row_value`,
      `  WHERE row_value.${quoteIdent("id")} = ${idValue};`,
      "",
      `  SELECT row_value.xmin::text INTO ${xminNames.get(parameter.id)}`,
      `  FROM ${qname(schema, entity.naming.sqlTable)} AS row_value`,
      `  WHERE row_value.${quoteIdent("id")} = ${idValue};`,
      "",
    );
  }
  const revision = revisionExpression(ir, action, decision, xminNames);
  body.push(`  v_revision := ${revision};`, "");
  const missing = decision.entityLoads.map((load) => `${xminNames.get(load.parameterId)} IS NULL`).join(" OR ");
  if (missing) {
    body.push(
      `  IF ${missing} THEN`,
      `    RETURN ${decisionJson(action, "denied", undefined, { kind: "authorization", ruleId: decision.absenceProjection.explanationRuleId })};`,
      "  END IF;",
      "",
    );
  }
  const context = { ir, action, recordNames };
  body.push(
    `  IF NOT ((${lowerExpression(decision.authorization.expression, context)}) IS TRUE) THEN`,
    `    RETURN ${decisionJson(action, "denied", undefined, { kind: "authorization", ruleId: decision.authorization.id })};`,
    "  END IF;",
    "",
    "  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN",
    `    RETURN ${decisionJson(action, "stale", "v_revision", { kind: "revision", ruleId: decision.revision.ruleId })};`,
    "  END IF;",
    "",
  );
  for (const precondition of decision.preconditions) {
    body.push(
      `  IF NOT ((${lowerExpression(precondition.expression, context)}) IS TRUE) THEN`,
      `    RETURN ${decisionJson(action, "notApplicable", "v_revision", { kind: "requirement", ruleId: precondition.id })};`,
      "  END IF;",
      "",
    );
  }
  body.push(`  RETURN ${decisionJson(action, "applicable", "v_revision", undefined)};`);
  return `CREATE OR REPLACE FUNCTION ${qname(schema, decisionFunctionName(action.id))}(${[...callable.map(parameterSql), "p_expected_revision text"].join(", ")})
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
${declarations.join("\n")}
BEGIN
${body.join("\n")}
END
$modellang$;

REVOKE ALL ON FUNCTION ${decisionFunctionSignature(ir, action)} FROM PUBLIC;
`;
}

function generateDecisions(ir: ModelIR, plan: DecisionPlan): string {
  return `-- Generated pure applicability queries. These decisions grant no execution authority.
SET ROLE modellang_owner;

${ir.actions.map((action) => generateDecision(ir, action, decisionAction(plan, action.id))).join("\n")}
RESET ROLE;
`;
}

function generateQuery(ir: ModelIR, query: IRQuery): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const callable = query.parameters.filter((parameter) => query.callableParameters.includes(parameter.id));
  const sourceEntity = entityById(ir, query.sourceEntityId);
  const orderField = fieldById(ir, query.orderBy.fieldId).field;
  const idField = fieldById(ir, sourceEntity.idFieldId).field;
  const recordNames = new Map<string, string>([["queryRow", "v_row"]]);
  for (const parameter of query.parameters.filter((candidate) => candidate.type.startsWith("entity:"))) {
    recordNames.set(parameter.id, `v_${snakeCase(parameter.name)}`);
  }
  const declarations = [
    "  v_principal_id uuid;",
    "  v_result jsonb;",
  ];
  for (const parameter of query.parameters.filter((candidate) => candidate.type.startsWith("entity:"))) {
    const entity = entityById(ir, parameter.type);
    declarations.push(`  ${recordNames.get(parameter.id)} ${qname(schema, entity.naming.sqlTable)}%ROWTYPE;`);
  }
  const body: string[] = [
    `  SELECT identity.${quoteIdent("principal_id")} INTO v_principal_id`,
    `  FROM ${qname(internal, "resolve_principal")}() AS identity;`,
    "",
  ];
  for (const parameter of callable.filter((candidate) => isMoneyType(candidate.type))) {
    body.push(...moneyParameterValidation(parameter));
  }
  for (const parameter of query.parameters.filter((candidate) => candidate.type.startsWith("entity:"))) {
    const entity = entityById(ir, parameter.type);
    const idFieldForParameter = fieldById(ir, entity.idFieldId).field;
    const idValue = parameter.caller ? "v_principal_id" : quoteIdent(parameter.naming.sqlParameter);
    body.push(
      `  SELECT * INTO ${recordNames.get(parameter.id)}`,
      `  FROM ${qname(schema, entity.naming.sqlTable)}`,
      `  WHERE ${quoteIdent(idFieldForParameter.naming.sqlColumn)} = ${idValue};`,
      "",
      "  IF NOT FOUND THEN",
      `    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:${query.authorization.id}';`,
      "  END IF;",
      "",
    );
  }
  const context = { ir, query, recordNames };
  body.push(
    `  IF NOT ((${lowerExpression(query.authorization.expression, context)}) IS TRUE) THEN`,
    `    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:${query.authorization.id}';`,
    "  END IF;",
    "",
    "  SELECT COALESCE(",
    `    pg_catalog.jsonb_agg(v_query.${quoteIdent("item")} ORDER BY v_query.${quoteIdent("sort_value")} ${query.orderBy.direction.toUpperCase()}, v_query.${quoteIdent("identity")} ASC),`,
    "    '[]'::jsonb",
    "  ) INTO v_result",
    "  FROM (",
    `    SELECT ${rowJson(sourceEntity, "v_row")} AS ${quoteIdent("item")},`,
    `           v_row.${quoteIdent(orderField.naming.sqlColumn)} AS ${quoteIdent("sort_value")},`,
    `           v_row.${quoteIdent(idField.naming.sqlColumn)} AS ${quoteIdent("identity")}`,
    `    FROM ${qname(schema, sourceEntity.naming.sqlTable)} AS v_row`,
    `    WHERE ((${lowerExpression(query.rowPolicy.expression, context)}) IS TRUE)`,
    `    ORDER BY v_row.${quoteIdent(orderField.naming.sqlColumn)} ${query.orderBy.direction.toUpperCase()}, v_row.${quoteIdent(idField.naming.sqlColumn)} ASC`,
    `    LIMIT ${query.limit}`,
    "  ) AS v_query;",
    "",
    "  RETURN v_result;",
  );
  return `CREATE OR REPLACE FUNCTION ${qname(schema, query.naming.sqlFunction)}(${callable.map(parameterSql).join(", ")})
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
${declarations.join("\n")}
BEGIN
${body.join("\n")}
END
$modellang$;

REVOKE ALL ON FUNCTION ${functionSignature(ir, query)} FROM PUBLIC;
`;
}

function payloadJsonExpression(field: IRField, payload = "v_payload_json"): string {
  const value = `${payload}->'${field.name.replaceAll("'", "''")}'`;
  let decoded: string;
  if (isMoneyType(field.type)) decoded = `(${value}->>'amount')::numeric`;
  else if (field.type.startsWith("set:enum:")) decoded = `ARRAY(SELECT pg_catalog.jsonb_array_elements_text(${value}))`;
  else if (field.type.startsWith("entity:") || field.type === "UUID") decoded = `(${value}#>>'{}')::uuid`;
  else if (field.type === "DateTime") decoded = `(${value}#>>'{}')::timestamptz`;
  else if (field.type === "Int") decoded = `(${value}#>>'{}')::bigint`;
  else if (field.type === "Decimal") decoded = `(${value}#>>'{}')::numeric`;
  else if (field.type === "Boolean") decoded = `(${value}#>>'{}')::boolean`;
  else decoded = `${value}#>>'{}'`;
  return field.optional ? `CASE WHEN ${value} = 'null'::jsonb THEN NULL ELSE ${decoded} END` : decoded;
}

function payloadValidationSql(ir: ModelIR, entity: IREntity): string[] {
  const keys = entity.fields.map((field) => field.name).sort().map((name) => `'${name.replaceAll("'", "''")}'`).join(", ");
  const checks: string[] = [
    "  IF pg_catalog.jsonb_typeof(v_payload_json) IS DISTINCT FROM 'object' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
    "  END IF;",
    "  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_payload_keys FROM pg_catalog.jsonb_object_keys(v_payload_json) AS key_name;",
    `  IF v_payload_keys IS DISTINCT FROM ARRAY[${keys}]::text[] THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
    "  END IF;",
  ];
  for (const field of entity.fields) {
    const value = `v_payload_json->'${field.name.replaceAll("'", "''")}'`;
    const nullAllowed = field.optional ? `${value} = 'null'::jsonb OR ` : "";
    let condition: string;
    if (isMoneyType(field.type)) {
      const profile = moneyProfileFromType(field.type)!;
      condition = `${nullAllowed}(pg_catalog.jsonb_typeof(${value}) = 'object' AND (SELECT pg_catalog.array_agg(key_name ORDER BY key_name) FROM pg_catalog.jsonb_object_keys(${value}) AS key_name) = ARRAY['amount','currency']::text[] AND ${value}->>'currency' = '${profile.currency}' AND pg_catalog.jsonb_typeof(${value}->'amount') = 'string' AND ${value}->>'amount' ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$')`;
    } else if (field.type.startsWith("set:enum:")) {
      const enumeration = ir.enums.find((candidate) => candidate.id === field.type.slice("set:".length))!;
      const members = enumeration.members.map((member) => `'${member.naming.sqlValue.replaceAll("'", "''")}'`).join(", ");
      condition = `${nullAllowed}(pg_catalog.jsonb_typeof(${value}) = 'array' AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(${value}) AS item WHERE pg_catalog.jsonb_typeof(item) <> 'string' OR item#>>'{}' NOT IN (${members})) AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(${value})) = (SELECT pg_catalog.count(DISTINCT item#>>'{}') FROM pg_catalog.jsonb_array_elements(${value}) AS item))`;
    } else if (field.type.startsWith("enum:")) {
      const enumeration = ir.enums.find((candidate) => candidate.id === field.type)!;
      const members = enumeration.members.map((member) => `'${member.naming.sqlValue.replaceAll("'", "''")}'`).join(", ");
      condition = `${nullAllowed}(pg_catalog.jsonb_typeof(${value}) = 'string' AND ${value}#>>'{}' IN (${members}))`;
    } else if (field.type === "Boolean") condition = `${nullAllowed}pg_catalog.jsonb_typeof(${value}) = 'boolean'`;
    else if (field.type === "Int") condition = `${nullAllowed}pg_catalog.jsonb_typeof(${value}) = 'number'`;
    else if (field.type === "Decimal") condition = `${nullAllowed}(pg_catalog.jsonb_typeof(${value}) = 'string' AND ${value}#>>'{}' ~ '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$')`;
    else condition = `${nullAllowed}pg_catalog.jsonb_typeof(${value}) = 'string'`;
    checks.push(
      `  IF NOT ((${condition}) IS TRUE) THEN`,
      "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
      "  END IF;",
    );
  }
  checks.push(
    "  BEGIN",
    `    SELECT ${entity.fields.map((field) => payloadJsonExpression(field)).join(", ")}`,
    "    INTO v_payload;",
    "  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
    "  END;",
  );
  for (const field of entity.fields.filter((candidate) => isMoneyType(candidate.type))) {
    const profile = moneyProfileFromType(field.type)!;
    const column = `v_payload.${quoteIdent(field.naming.sqlColumn)}`;
    checks.push(
      `  IF NOT ((${field.optional ? `${column} IS NULL OR ` : ""}(${column} <> 'NaN'::numeric AND pg_catalog.scale(${column}) <= ${profile.scale} AND pg_catalog.abs(${column}) < ${moneyMagnitudeLimit(profile)})) IS TRUE) THEN`,
      "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
      "  END IF;",
    );
  }
  return checks;
}

function consumerEvidenceSql(ir: ModelIR, consumer: IRConsumer): string {
  const requirements = consumer.preconditions.map((rule) =>
    `pg_catalog.jsonb_build_object('ruleId', '${rule.id.replaceAll("'", "''")}', 'outcome', 'passed')`);
  return `pg_catalog.jsonb_build_object('version', 1, 'outcome', 'consumed', `
    + `'consumerId', '${consumer.id.replaceAll("'", "''")}', 'sourceEventId', v_source_event_id, `
    + `'sourceContract', pg_catalog.jsonb_build_object('eventId', '${consumer.sourceEventId.replaceAll("'", "''")}', 'modelId', v_source_model_id, 'modelVersion', v_source_model_version, 'sourceHash', v_source_hash), `
    + `'authorization', pg_catalog.jsonb_build_object('ruleId', '${consumer.authorization.id.replaceAll("'", "''")}', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), `
    + `'requirements', pg_catalog.jsonb_build_array(${requirements.join(", ")}), `
    + `'emittedEventIds', pg_catalog.to_jsonb(ARRAY[${consumer.emittedEventIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(", ")}]::text[]), `
    + `'failurePolicy', pg_catalog.jsonb_build_object('mode', '${consumer.failurePolicy.mode}'${consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts" ? `, 'maxAttempts', ${consumer.failurePolicy.maxAttempts}, 'recovery', '${consumer.failurePolicy.recovery}'` : ""}))`;
}

function generateConsumer(ir: ModelIR, consumer: IRConsumer): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const event = ir.events.find((candidate) => candidate.id === consumer.sourceEventId)!;
  const payloadEntity = entityById(ir, consumer.acceptedPayloadEntityId);
  const returnEntity = entityById(ir, consumer.returnEntityId);
  const source = event.source.kind === "local"
    ? { modelId: ir.model.id, modelVersion: ir.model.version, sourceHash: ir.model.sourceHash }
    : event.source;
  const recordNames = new Map([[consumer.payloadParameter.id, "v_payload"]]);
  const context: ExpressionContext = { ir, consumer, recordNames };
  const legacyEnvelopeKeys = [
    "actionId", "causationId", "correlationId", "deliveryAttempt", "eventId", "eventName", "id", "modelId",
    "modelVersion", "occurredAt", "ordinal", "payload", "sourceHash", "targetId",
  ].map((key) => `'${key}'`).join(", ");
  const envelopeKeys = [
    "actionId", "causationId", "consumerId", "correlationId", "deliveryAttempt", "eventId", "eventName", "id", "modelId",
    "modelVersion", "occurredAt", "ordinal", "payload", "sourceHash", "targetId",
  ].map((key) => `'${key}'`).join(", ");
  const declarations = [
    "  v_source_event_id uuid;",
    "  v_target_id uuid;",
    "  v_source_model_id text;",
    "  v_source_model_version text;",
    "  v_source_hash text;",
    "  v_envelope_hash text;",
    "  v_existing_hash text;",
    "  v_existing_status text;",
    "  v_existing_response jsonb;",
    "  v_delivery_attempt integer;",
    "  v_correlation_id text;",
    "  v_causation_id text;",
    "  v_payload_json jsonb;",
    "  v_envelope_keys text[];",
    "  v_payload_keys text[];",
    "  v_failure_state jsonb;",
    "  v_inbox_id bigint;",
    "  v_consumer_audit_id bigint;",
    "  v_authority_policy_id text;",
    "  v_authority_id text;",
    "  v_response jsonb;",
    `  v_payload ${qname(schema, payloadEntity.naming.sqlTable)}%ROWTYPE;`,
    `  v_result ${qname(schema, returnEntity.naming.sqlTable)}%ROWTYPE;`,
  ];
  const body: string[] = [
    ...consumerRoleCheck(),
    "  IF p_envelope IS NULL OR pg_catalog.jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END IF;",
    "  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_envelope_keys FROM pg_catalog.jsonb_object_keys(p_envelope) AS key_name;",
    `  IF v_envelope_keys IS NOT DISTINCT FROM ARRAY[${legacyEnvelopeKeys}]::text[] THEN`,
    "    p_envelope := p_envelope || pg_catalog.jsonb_build_object('consumerId', NULL);",
    `  ELSIF v_envelope_keys IS DISTINCT FROM ARRAY[${envelopeKeys}]::text[] THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END IF;",
    "  IF pg_catalog.jsonb_typeof(p_envelope->'id') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'eventId') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'eventName') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'modelId') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'modelVersion') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'sourceHash') IS DISTINCT FROM 'string'",
    "     OR (p_envelope->'actionId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'actionId') IS DISTINCT FROM 'string')",
    "     OR (p_envelope->'consumerId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'consumerId') IS DISTINCT FROM 'string')",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'targetId') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'payload') IS DISTINCT FROM 'object'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'correlationId') IS DISTINCT FROM 'string'",
    "     OR (p_envelope->'causationId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'causationId') IS DISTINCT FROM 'string')",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'occurredAt') IS DISTINCT FROM 'string'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'ordinal') IS DISTINCT FROM 'number'",
    "     OR pg_catalog.jsonb_typeof(p_envelope->'deliveryAttempt') IS DISTINCT FROM 'number' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END IF;",
    "  BEGIN",
    "    v_source_event_id := (p_envelope->>'id')::uuid;",
    "    v_target_id := (p_envelope->>'targetId')::uuid;",
    "    v_delivery_attempt := (p_envelope->>'deliveryAttempt')::integer;",
    "    PERFORM (p_envelope->>'occurredAt')::timestamptz, (p_envelope->>'ordinal')::integer;",
    "  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';",
    "  END;",
    "  v_source_model_id := p_envelope->>'modelId';",
    "  v_source_model_version := p_envelope->>'modelVersion';",
    "  v_source_hash := p_envelope->>'sourceHash';",
    "  v_correlation_id := p_envelope->>'correlationId';",
    "  v_causation_id := p_envelope->>'causationId';",
    "  v_payload_json := p_envelope->'payload';",
    `  IF p_envelope->>'eventId' IS DISTINCT FROM '${event.id.replaceAll("'", "''")}'`,
    `     OR p_envelope->>'eventName' IS DISTINCT FROM '${event.name.replaceAll("'", "''")}'`,
    `     OR v_source_model_id IS DISTINCT FROM '${source.modelId.replaceAll("'", "''")}'`,
    `     OR v_source_model_version IS DISTINCT FROM '${source.modelVersion.replaceAll("'", "''")}'`,
    `     OR v_source_hash IS DISTINCT FROM '${source.sourceHash.replaceAll("'", "''")}'`,
    "     OR NOT ((((p_envelope->>'actionId') IS NOT NULL AND (p_envelope->>'actionId' ~ '^action:.+$') AND p_envelope->'consumerId' = 'null'::jsonb)",
    "              OR (p_envelope->'actionId' = 'null'::jsonb AND (p_envelope->>'consumerId') IS NOT NULL AND (p_envelope->>'consumerId' ~ '^consumer:.+$'))) IS TRUE)",
    "     OR (p_envelope->>'ordinal')::integer < 0",
    "     OR v_delivery_attempt < 1",
    "     OR v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
    "     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$') THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_CONTRACT';",
    "  END IF;",
    `  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${consumer.id.replaceAll("'", "''")}:' || v_source_event_id::text, 0));`,
    `  v_failure_state := ${qname(internal, "consumer_failure_state")}('${consumer.id.replaceAll("'", "''")}', v_source_event_id::text);`,
    "  IF v_failure_state->>'status' = 'deadLetter' THEN",
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_DEAD_LETTER';",
    "  END IF;",
    "  v_envelope_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(((p_envelope - 'deliveryAttempt'))::text, 'UTF8')), 'hex');",
    `  INSERT INTO ${qname(internal, "event_inbox")} (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}, ${quoteIdent("source_event_type")}, ${quoteIdent("source_event_name")}, ${quoteIdent("source_model_id")}, ${quoteIdent("source_model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("envelope_hash")}, ${quoteIdent("payload")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")}, ${quoteIdent("first_delivery_attempt")}, ${quoteIdent("last_delivery_attempt")})`,
    `  VALUES ('${consumer.id.replaceAll("'", "''")}', v_source_event_id, '${event.id.replaceAll("'", "''")}', '${event.name.replaceAll("'", "''")}', v_source_model_id, v_source_model_version, v_source_hash, v_envelope_hash, v_payload_json, v_correlation_id, v_causation_id, v_delivery_attempt, v_delivery_attempt)`,
    `  ON CONFLICT (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}) DO NOTHING RETURNING ${quoteIdent("id")} INTO v_inbox_id;`,
    "  IF v_inbox_id IS NULL THEN",
    `    SELECT ${quoteIdent("envelope_hash")}, ${quoteIdent("status")}, ${quoteIdent("response")} INTO v_existing_hash, v_existing_status, v_existing_response`,
    `    FROM ${qname(internal, "event_inbox")} WHERE ${quoteIdent("consumer_id")} = '${consumer.id.replaceAll("'", "''")}' AND ${quoteIdent("source_event_id")} = v_source_event_id FOR UPDATE;`,
    "    IF v_existing_hash IS DISTINCT FROM v_envelope_hash THEN",
    "      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_EVENT_CONFLICT';",
    "    END IF;",
    "    IF v_existing_status IS DISTINCT FROM 'executed' OR v_existing_response IS NULL THEN",
    "      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_EVENT_INCOMPLETE';",
    "    END IF;",
    `    UPDATE ${qname(internal, "event_inbox")} SET ${quoteIdent("last_delivery_attempt")} = GREATEST(${quoteIdent("last_delivery_attempt")}, v_delivery_attempt) WHERE ${quoteIdent("consumer_id")} = '${consumer.id.replaceAll("'", "''")}' AND ${quoteIdent("source_event_id")} = v_source_event_id;`,
    "    RETURN v_existing_response;",
    "  END IF;",
    ...payloadValidationSql(ir, payloadEntity),
    "  IF v_payload.id IS DISTINCT FROM v_target_id THEN",
    "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';",
    "  END IF;",
  ];
  if (consumer.effect.kind === "update") {
    body.push(
      `  SELECT * INTO v_result FROM ${qname(schema, returnEntity.naming.sqlTable)} WHERE ${quoteIdent("id")} = v_target_id FOR UPDATE;`,
      "  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_TARGET'; END IF;",
    );
  }
  body.push(
    `  IF NOT ((${lowerExpression(consumer.authorization.expression, context)}) IS TRUE) THEN`,
    `    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_AUTHORIZATION:${consumer.authorization.id.replaceAll("'", "''")}';`,
    "  END IF;",
  );
  const authorityCall = authorityPolicyCall(consumer.authorization.expression);
  if (authorityCall) {
    body.push(
      `  v_authority_policy_id := '${authorityCall.policyId.replaceAll("'", "''")}';`,
      `  v_authority_id := ${policyAuthorityBranchSql(authorityCall, context)};`,
    );
  }
  for (const requirement of consumer.preconditions) {
    body.push(
      `  IF NOT ((${lowerExpression(requirement.expression, context)}) IS TRUE) THEN`,
      `    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_CONSUMER_PRECONDITION:${requirement.id.replaceAll("'", "''")}';`,
      "  END IF;",
    );
  }
  const effectEntity = entityById(ir, consumer.effect.entityId);
  if (consumer.effect.kind === "create") {
    const fields = consumer.effect.assignments.map((assignment) => fieldById(ir, assignment.fieldId).field);
    if (fields.length === 0) {
      body.push(`  INSERT INTO ${qname(schema, effectEntity.naming.sqlTable)} DEFAULT VALUES RETURNING * INTO v_result;`);
    } else {
      body.push(
        `  INSERT INTO ${qname(schema, effectEntity.naming.sqlTable)} (${fields.map((field) => quoteIdent(field.naming.sqlColumn)).join(", ")})`,
        `  VALUES (${consumer.effect.assignments.map((assignment) => lowerExpression(assignment.expression, context)).join(", ")}) RETURNING * INTO v_result;`,
      );
    }
  } else {
    body.push(
      `  UPDATE ${qname(schema, effectEntity.naming.sqlTable)} SET ${consumer.effect.assignments.map((assignment) => {
        const field = fieldById(ir, assignment.fieldId).field;
        return `${quoteIdent(field.naming.sqlColumn)} = ${lowerExpression(assignment.expression, context)}`;
      }).join(", ")} WHERE ${quoteIdent("id")} = v_target_id RETURNING * INTO v_result;`,
    );
  }
  body.push(
    `  v_response := ${rowJson(returnEntity, "v_result")};`,
    `  INSERT INTO ${qname(internal, "consumer_audit")} (${quoteIdent("consumer_id")}, ${quoteIdent("source_event_id")}, ${quoteIdent("source_event_type")}, ${quoteIdent("source_model_id")}, ${quoteIdent("source_model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("target_id")}, ${quoteIdent("authorization_rule_id")}, ${quoteIdent("policy_id")}, ${quoteIdent("authority_id")}, ${quoteIdent("decision_evidence")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")})`,
    `  VALUES ('${consumer.id.replaceAll("'", "''")}', v_source_event_id, '${event.id.replaceAll("'", "''")}', v_source_model_id, v_source_model_version, v_source_hash, v_result.${quoteIdent("id")}, '${consumer.authorization.id.replaceAll("'", "''")}', v_authority_policy_id, v_authority_id, ${consumerEvidenceSql(ir, consumer)}, v_correlation_id, v_causation_id) RETURNING ${quoteIdent("id")} INTO v_consumer_audit_id;`,
  );
  consumer.emittedEventIds.forEach((emittedEventId, ordinal) => {
    const emittedEvent = ir.events.find((candidate) => candidate.id === emittedEventId);
    if (!emittedEvent) throw new Error(`E4014 Missing consumer-emitted event ${emittedEventId}`);
    body.push(
      `  INSERT INTO ${qname(internal, "event_outbox")} (${quoteIdent("model_id")}, ${quoteIdent("model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("event_id")}, ${quoteIdent("event_name")}, ${quoteIdent("payload_entity_id")}, ${quoteIdent("consumer_id")}, ${quoteIdent("target_id")}, ${quoteIdent("payload")}, ${quoteIdent("correlation_id")}, ${quoteIdent("causation_id")}, ${quoteIdent("consumer_audit_id")}, ${quoteIdent("ordinal")}, ${quoteIdent("publication_max_attempts")})`,
      `  VALUES ('${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', '${emittedEvent.id.replaceAll("'", "''")}', '${emittedEvent.name.replaceAll("'", "''")}', '${emittedEvent.payloadEntityId.replaceAll("'", "''")}', '${consumer.id.replaceAll("'", "''")}', v_result.${quoteIdent("id")}, v_response, v_correlation_id, v_source_event_id::text, v_consumer_audit_id, ${ordinal}, ${emittedEvent.publicationFailurePolicy.mode === "deadLetterAfterMaxAttempts" ? emittedEvent.publicationFailurePolicy.maxAttempts : "(NULL::integer)"});`,
      "",
    );
  });
  body.push(
    `  UPDATE ${qname(internal, "consumer_failure")} SET ${quoteIdent("disposition")} = 'resolved', ${quoteIdent("max_attempts")} = ${consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts" ? consumer.failurePolicy.maxAttempts : "(NULL::integer)"}, ${quoteIdent("terminal_at")} = (NULL::timestamptz), ${quoteIdent("resolved_at")} = pg_catalog.clock_timestamp()`,
    `  WHERE ${quoteIdent("consumer_id")} = '${consumer.id.replaceAll("'", "''")}' AND ${quoteIdent("source_event_id")} = v_source_event_id::text;`,
    `  UPDATE ${qname(internal, "event_inbox")} SET ${quoteIdent("status")} = 'executed', ${quoteIdent("target_id")} = v_result.${quoteIdent("id")}, ${quoteIdent("response")} = v_response, ${quoteIdent("consumer_audit_id")} = v_consumer_audit_id, ${quoteIdent("completed_at")} = pg_catalog.transaction_timestamp() WHERE ${quoteIdent("id")} = v_inbox_id;`,
    "  RETURN v_response;",
  );
  return `CREATE OR REPLACE FUNCTION ${qname(internal, consumer.naming.sqlFunction)}(p_envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
${declarations.join("\n")}
BEGIN
${body.join("\n")}
END
$modellang$;

REVOKE ALL ON FUNCTION ${qname(internal, consumer.naming.sqlFunction)}(jsonb) FROM PUBLIC;
`;
}

function generateConsumers(ir: ModelIR): string {
  return `-- Generated private transactional event consumers. Broker transport remains host-owned.
SET ROLE modellang_owner;

${ir.consumers.map((consumer) => generateConsumer(ir, consumer)).join("\n")}
RESET ROLE;
`;
}

function generateQueries(ir: ModelIR): string {
  return `-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

${ir.queries.map((query) => generateQuery(ir, query)).join("\n")}
RESET ROLE;
`;
}

function generateGrants(ir: ModelIR, includeApplicability = true): string {
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  const lines = [
    "-- Generated least-privilege application boundary.",
    `REVOKE CREATE ON SCHEMA ${quoteIdent(schema)} FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;`,
    `REVOKE ALL ON SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO modellang_app;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(internal)} TO modellang_gateway;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(internal)} TO modellang_dispatcher;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(internal)} TO modellang_consumer;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(internal)} TO modellang_recovery;`,
    "",
  ];
  for (const entity of ir.entities) {
    const table = qname(schema, entity.naming.sqlTable);
    lines.push(
      `REVOKE ALL ON TABLE ${table} FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery;`,
    );
  }
  lines.push("");
  for (const action of ir.actions) {
    lines.push(
      `REVOKE ALL ON FUNCTION ${functionSignature(ir, action)} FROM PUBLIC;`,
      `GRANT EXECUTE ON FUNCTION ${functionSignature(ir, action)} TO modellang_app;`,
    );
    if (includeApplicability) lines.push(
      `REVOKE ALL ON FUNCTION ${decisionFunctionSignature(ir, action)} FROM PUBLIC;`,
      `GRANT EXECUTE ON FUNCTION ${decisionFunctionSignature(ir, action)} TO modellang_app;`,
    );
  }
  for (const query of ir.queries) {
    lines.push(
      `REVOKE ALL ON FUNCTION ${functionSignature(ir, query)} FROM PUBLIC;`,
      `GRANT EXECUTE ON FUNCTION ${functionSignature(ir, query)} TO modellang_app;`,
    );
  }
  for (const consumer of ir.consumers) {
    lines.push(
      `REVOKE ALL ON FUNCTION ${qname(internal, consumer.naming.sqlFunction)}(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery;`,
      `GRANT EXECUTE ON FUNCTION ${qname(internal, consumer.naming.sqlFunction)}(jsonb) TO modellang_consumer;`,
    );
  }
  lines.push(
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "bind_gateway_identity")}(text, text) TO modellang_gateway;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "claim_events")}(integer, integer) TO modellang_dispatcher;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "ack_event")}(uuid, uuid) TO modellang_dispatcher;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "release_event")}(uuid, uuid) TO modellang_dispatcher;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "fail_event")}(uuid, uuid, text) TO modellang_dispatcher;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "consumer_failure_state")}(text, text) TO modellang_consumer;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "record_consumer_failure")}(text, text, integer, text) TO modellang_consumer;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "recover_consumer_failure")}(text, text, text) TO modellang_recovery;`,
  );
  for (const consumer of ir.consumers) {
    lines.push(`GRANT EXECUTE ON FUNCTION ${qname(internal, consumer.naming.sqlFunction)}(jsonb) TO modellang_consumer;`);
  }
  lines.push(
    "",
    "ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    "ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;",
    `REVOKE modellang_owner FROM modellang_app;`,
    `REVOKE modellang_owner FROM modellang_gateway;`,
    `REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;`,
    `REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;`,
    `REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;`,
    `REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;`,
    `REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer FROM modellang_recovery;`,
    `REVOKE modellang_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;`,
    `REVOKE modellang_gateway FROM modellang_app;`,
    `GRANT modellang_app TO modellang_gateway;`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function generateSeed(ir: ModelIR): string {
  if (ir.model.name === "Reservations") {
    const schema = ir.model.naming.sqlSchema;
    const internal = ir.model.naming.internalSchema;
    return `-- Example-only deterministic seed. Demo login roles must exist before applying this file.
SET ROLE modellang_owner;

INSERT INTO ${qname(schema, "user")} (${quoteIdent("id")}, ${quoteIdent("name")}) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Reserver One'),
  ('10000000-0000-4000-8000-000000000002', 'Reserver Two');

INSERT INTO ${qname(schema, "resource")} (${quoteIdent("id")}, ${quoteIdent("name")}) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Conference Room A'),
  ('20000000-0000-4000-8000-000000000002', 'Conference Room B');

INSERT INTO ${qname(internal, "principal_binding")} (${quoteIdent("database_principal")}, ${quoteIdent("principal_id")}) VALUES
  ('ml_reserver_one', '10000000-0000-4000-8000-000000000001'),
  ('ml_reserver_two', '10000000-0000-4000-8000-000000000002');

INSERT INTO ${qname(internal, "gateway_principal_binding")} (${quoteIdent("issuer")}, ${quoteIdent("subject")}, ${quoteIdent("principal_id")}) VALUES
  ('https://auth.example.test', 'reserver-one', '10000000-0000-4000-8000-000000000001'),
  ('https://auth.example.test', 'reserver-two', '10000000-0000-4000-8000-000000000002');

RESET ROLE;
`;
  }
  if (ir.model.name !== "Procurement") {
    return "-- Example seed data is defined only for the Procurement demonstration model.\n";
  }
  const schema = ir.model.naming.sqlSchema;
  const internal = ir.model.naming.internalSchema;
  return `-- Example-only deterministic seed. Demo login roles must exist before applying this file.
SET ROLE modellang_owner;

INSERT INTO ${qname(schema, "user")} (${quoteIdent("id")}, ${quoteIdent("name")}, ${quoteIdent("roles")}) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Employee One', ARRAY['EMPLOYEE']::text[]),
  ('00000000-0000-4000-8000-000000000002', 'Employee Two', ARRAY['EMPLOYEE']::text[]),
  ('00000000-0000-4000-8000-000000000003', 'Manager', ARRAY['EMPLOYEE', 'MANAGER']::text[]),
  ('00000000-0000-4000-8000-000000000004', 'Finance', ARRAY['EMPLOYEE', 'FINANCE']::text[]);

INSERT INTO ${qname(internal, "principal_binding")} (${quoteIdent("database_principal")}, ${quoteIdent("principal_id")}) VALUES
  ('ml_employee_one', '00000000-0000-4000-8000-000000000001'),
  ('ml_employee_two', '00000000-0000-4000-8000-000000000002'),
  ('ml_manager', '00000000-0000-4000-8000-000000000003'),
  ('ml_finance', '00000000-0000-4000-8000-000000000004');

INSERT INTO ${qname(internal, "gateway_principal_binding")} (${quoteIdent("issuer")}, ${quoteIdent("subject")}, ${quoteIdent("principal_id")}) VALUES
  ('https://auth.example.test', 'employee-one', '00000000-0000-4000-8000-000000000001'),
  ('https://auth.example.test', 'employee-two', '00000000-0000-4000-8000-000000000002'),
  ('https://auth.example.test', 'manager', '00000000-0000-4000-8000-000000000003'),
  ('https://auth.example.test', 'finance', '00000000-0000-4000-8000-000000000004');

RESET ROLE;
`;
}

function generateGatewayUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.11 -> 0.12 PostgreSQL gateway-boundary upgrade.
-- Run as the same administrative role used for generated installation and migrations.
BEGIN;
${generateGatewayRoleStatements()}
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}

SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;

${generateGatewayInfrastructureStatements(ir, false).join("\n")}
${generateDecisionEvidenceInfrastructureStatements(ir).join("\n")}
${generateCommandReceiptInfrastructureStatements(ir).join("\n")}
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

-- Existing guarded callables must resolve both direct and gateway identities.
${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateQueries(ir).trim()}
${generateGrants(ir, false).trim()}
COMMIT;
`;
}

function generateApplicabilityUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.16 -> 0.17 applicability-boundary upgrade.
-- Run as the same administrative role used for generated installation and migrations.
BEGIN;
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateSnapshotResolverStatements(ir).join("\n")}
${generateDecisionEvidenceInfrastructureStatements(ir).join("\n")}
${generateCommandReceiptInfrastructureStatements(ir).join("\n")}
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateDecisions(ir, plan).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateDecisionEvidenceUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.17 -> 0.18 durable decision-evidence upgrade.
-- Historical action audit rows remain explicitly evidence-unknown; new executions record complete evidence.
BEGIN;
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateDecisionEvidenceInfrastructureStatements(ir).join("\n")}
${generateCommandReceiptInfrastructureStatements(ir).join("\n")}
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateDecisions(ir, plan).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateReliableCommandUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.18 -> 0.19 reliable-command upgrade.
-- Historical audit rows remain correlation- and receipt-unknown; new reliable commands write complete receipts.
BEGIN;
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateCommandReceiptInfrastructureStatements(ir).join("\n")}
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateDomainEventUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.19 -> 0.20 transactional domain-event upgrade.
-- Existing domain and audit rows do not synthesize historical events; new executions append events atomically.
BEGIN;
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateEventConsumerUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.20 -> 0.21 reliable typed event-consumer upgrade.
-- No historical events are consumed and no inbox completion is fabricated.
BEGIN;
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateEventChainUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.21 -> 0.22 transactional event-chain upgrade.
-- Existing producer events remain valid; no historical downstream events are synthesized.
BEGIN;
${generateDispatcherRoleStatements()}
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventInboxInfrastructureStatements(ir).join("\n")}
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateConsumerFailureUpgrade(ir: ModelIR): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.22 -> 0.23 durable consumer-failure disposition upgrade.
-- Existing failure rows remain non-terminal until evaluated under a declared current policy.
BEGIN;
${generateConsumerRoleStatements()}
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventInboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generateConsumerRecoveryUpgrade(ir: ModelIR): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.23 -> 0.24 private audited consumer-recovery upgrade.
-- Existing terminal failures remain terminal and no recovery audit is fabricated.
BEGIN;
${generateRecoveryRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventInboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

function generatePublicationFailureUpgrade(ir: ModelIR, plan: DecisionPlan): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `-- Idempotent ModelLang 0.24 -> 0.25 private bounded event-publication failure upgrade.
-- Existing outbox rows retain unbounded retry and no failure or terminal history is fabricated.
BEGIN;
${generateDispatcherRoleStatements()}
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;
${generateEventOutboxInfrastructureStatements(ir).join("\n")}
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateConsumers(ir).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

export function generatePostgres(ir: ModelIR, plan: DecisionPlan = generateDecisionPlan(ir)): PostgresOutput {
  return {
    "001_roles.sql": generateRoles(),
    "002_schema.sql": generateSchema(ir),
    "003_actions.sql": generateActions(ir, plan),
    "003_consumers.sql": generateConsumers(ir),
    "003_decisions.sql": generateDecisions(ir, plan),
    "003_queries.sql": generateQueries(ir),
    "004_grants.sql": generateGrants(ir),
    "005_seed.sql": generateSeed(ir),
    "006_upgrade_0_12.sql": generateGatewayUpgrade(ir, plan),
    "007_upgrade_0_17.sql": generateApplicabilityUpgrade(ir, plan),
    "008_upgrade_0_18.sql": generateDecisionEvidenceUpgrade(ir, plan),
    "009_upgrade_0_19.sql": generateReliableCommandUpgrade(ir, plan),
    "010_upgrade_0_20.sql": generateDomainEventUpgrade(ir, plan),
    "011_upgrade_0_21.sql": generateEventConsumerUpgrade(ir, plan),
    "012_upgrade_0_22.sql": generateEventChainUpgrade(ir, plan),
    "013_upgrade_0_23.sql": generateConsumerFailureUpgrade(ir),
    "014_upgrade_0_24.sql": generateConsumerRecoveryUpgrade(ir),
    "015_upgrade_0_25.sql": generatePublicationFailureUpgrade(ir, plan),
  };
}
