import type { IRAction, IREntity, IREnumMember, IRExpression, IRField, IRParameter, IRQuery, IRWorkflow, ModelIR } from "../ir.js";
import { isMoneyType, moneyMagnitudeLimit, moneyProfileFromType } from "../money.js";
import { quoteIdent, snakeCase } from "../naming.js";
import { decisionAction, decisionFunctionName, generateDecisionPlan, type ActionDecisionPlan, type DecisionPlan } from "../decision-plan.js";

export interface PostgresOutput {
  "001_roles.sql": string;
  "002_schema.sql": string;
  "003_actions.sql": string;
  "003_decisions.sql": string;
  "003_queries.sql": string;
  "004_grants.sql": string;
  "005_seed.sql": string;
  "006_upgrade_0_12.sql": string;
  "007_upgrade_0_17.sql": string;
  "008_upgrade_0_18.sql": string;
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
    + `'version', 1, 'outcome', 'executed', `
    + `'model', pg_catalog.jsonb_build_object('id', '${ir.model.id.replaceAll("'", "''")}', 'version', '${ir.model.version.replaceAll("'", "''")}', 'sourceHash', '${ir.model.sourceHash.replaceAll("'", "''")}'), `
    + `'actionId', '${action.id.replaceAll("'", "''")}', `
    + `'authorization', pg_catalog.jsonb_build_object('ruleId', '${decision.authorization.id.replaceAll("'", "''")}', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), `
    + `'requirements', pg_catalog.jsonb_build_array(${requirements.join(", ")}))`;
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
  ];
  for (const parameter of callable.filter((candidate) => isMoneyType(candidate.type))) {
    body.push(...moneyParameterValidation(parameter));
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
    `  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');`,
    `  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);`,
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
    `  INSERT INTO ${qname(internal, "action_audit")} (${quoteIdent("action_id")}, ${quoteIdent("database_principal")}, ${quoteIdent("principal_id")}, ${quoteIdent("target_id")}, ${quoteIdent("identity_issuer")}, ${quoteIdent("identity_subject")}, ${quoteIdent("model_id")}, ${quoteIdent("model_version")}, ${quoteIdent("source_hash")}, ${quoteIdent("authorization_rule_id")}, ${quoteIdent("decision_outcome")}, ${quoteIdent("policy_id")}, ${quoteIdent("authority_id")}, ${quoteIdent("decision_evidence")})`,
    `  VALUES ('${action.id}', session_user, v_principal_id, v_result.${quoteIdent("id")}, v_identity_issuer, v_identity_subject, '${ir.model.id.replaceAll("'", "''")}', '${ir.model.version.replaceAll("'", "''")}', '${ir.model.sourceHash.replaceAll("'", "''")}', '${decision.authorization.id.replaceAll("'", "''")}', 'executed', v_authority_policy_id, v_authority_id, ${decisionEvidenceSql(ir, action, decision)});`,
    "",
    `  RETURN ${rowJson(returnEntity, "v_result")};`,
  );
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
    `REVOKE CREATE ON SCHEMA ${quoteIdent(schema)} FROM PUBLIC, modellang_app, modellang_gateway;`,
    `REVOKE ALL ON SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO modellang_app;`,
    `GRANT USAGE ON SCHEMA ${quoteIdent(internal)} TO modellang_gateway;`,
    "",
  ];
  for (const entity of ir.entities) {
    const table = qname(schema, entity.naming.sqlTable);
    lines.push(
      `REVOKE ALL ON TABLE ${table} FROM PUBLIC, modellang_app;`,
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
  lines.push(
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway;`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${quoteIdent(internal)} FROM PUBLIC, modellang_app, modellang_gateway;`,
    `GRANT EXECUTE ON FUNCTION ${qname(internal, "bind_gateway_identity")}(text, text) TO modellang_gateway;`,
  );
  lines.push(
    "",
    "ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    "ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;",
    `REVOKE modellang_owner FROM modellang_app;`,
    `REVOKE modellang_owner FROM modellang_gateway;`,
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
RESET ROLE;

-- Existing guarded callables must resolve both direct and gateway identities.
${generateActions(ir, plan).trim()}
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
RESET ROLE;

${generateActions(ir, plan).trim()}
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
RESET ROLE;

${generateActions(ir, plan).trim()}
${generateDecisions(ir, plan).trim()}
${generateGrants(ir).trim()}
COMMIT;
`;
}

export function generatePostgres(ir: ModelIR, plan: DecisionPlan = generateDecisionPlan(ir)): PostgresOutput {
  return {
    "001_roles.sql": generateRoles(),
    "002_schema.sql": generateSchema(ir),
    "003_actions.sql": generateActions(ir, plan),
    "003_decisions.sql": generateDecisions(ir, plan),
    "003_queries.sql": generateQueries(ir),
    "004_grants.sql": generateGrants(ir),
    "005_seed.sql": generateSeed(ir),
    "006_upgrade_0_12.sql": generateGatewayUpgrade(ir, plan),
    "007_upgrade_0_17.sql": generateApplicabilityUpgrade(ir, plan),
    "008_upgrade_0_18.sql": generateDecisionEvidenceUpgrade(ir, plan),
  };
}
