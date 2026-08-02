export interface IRSpan {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface IRType {
  name: string;
  nullable: boolean;
}

export interface IRIdentity {
  strategy: "explicitStableId" | "nameDerived";
  stableId?: string;
}

export type IRExpression =
  | { kind: "literal"; value: string | number | boolean; type: string; nullable: false }
  | { kind: "moneyLiteral"; currency: string; amount: string; precision: number; scale: number; type: string; nullable: false }
  | { kind: "nullLiteral"; type: "null"; nullable: true }
  | { kind: "parameter"; parameterId: string; name: string; type: string; nullable: false }
  | { kind: "entityValue"; parameterId: string; name: string; entityId: string; type: string; nullable: false }
  | { kind: "fieldAccess"; source: string; parameter?: string; fieldId: string; fieldName: string; type: string; nullable: boolean }
  | { kind: "enumLiteral"; enumId: string; memberId: string; memberName: string; type: string; nullable: false }
  | { kind: "policyCall"; policyId: string; arguments: IRExpression[]; type: "Boolean"; nullable: false }
  | { kind: "unary"; operator: "not"; operand: IRExpression; type: "Boolean"; nullable: boolean }
  | { kind: "binary"; operator: "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "in"; left: IRExpression; right: IRExpression; type: "Boolean"; nullable: boolean; comparisonSemantics?: "entityIdentity" | "setMembership" }
  | { kind: "nullComparison"; operator: "isNull" | "isNotNull"; operand: IRExpression; type: "Boolean"; nullable: false };

export interface IREnumMember {
  id: string;
  name: string;
  identity: IRIdentity;
  span: IRSpan;
  naming: { sqlValue: string; typescriptValue: string };
}

export interface IREnum {
  id: string;
  name: string;
  identity: IRIdentity;
  members: IREnumMember[];
  span: IRSpan;
  naming: { sqlCheckPrefix: string; typescriptName: string };
}

export interface IRField {
  id: string;
  name: string;
  identity: IRIdentity;
  type: string;
  optional: boolean;
  default?: IRExpression;
  annotations: { name: string; value?: number | string }[];
  storage: "ordinary" | "snapshot";
  generation?: { strategy: "uuid" | "now"; authority: "database" };
  mutability: "mutable" | "immutable";
  span: IRSpan;
  naming: { sqlColumn: string };
}

export interface IRInvariant {
  id: string;
  name: string;
  identity: IRIdentity;
  expression: IRExpression;
  sourceExpression: string;
  span: IRSpan;
  naming: { sqlConstraint: string };
}

export interface IRTemporalExclusion {
  id: string;
  name: string;
  identity: IRIdentity;
  keyFieldId: string;
  startFieldId: string;
  endFieldId: string;
  intervalBounds: "[)";
  sourceExpression: string;
  span: IRSpan;
  naming: {
    sqlExclusionConstraint: string;
    sqlValidIntervalConstraint: string;
  };
}

export interface IREntity {
  id: string;
  name: string;
  identity: IRIdentity;
  fields: IRField[];
  invariants: IRInvariant[];
  temporalExclusions: IRTemporalExclusion[];
  idFieldId: string;
  span: IRSpan;
  naming: { sqlTable: string; typescriptName: string };
}

export interface IRParameter {
  id: string;
  name: string;
  type: string;
  caller: boolean;
  binding?: "session_user";
  span: IRSpan;
  naming: { sqlParameter: string; typescriptProperty: string };
}

export interface IRRule {
  id: string;
  name: string;
  expression: IRExpression;
  sourceExpression: string;
  span: IRSpan;
}

export interface IRPolicyBranch {
  id: string;
  name: string;
  identity: IRIdentity;
  expression: IRExpression;
  sourceExpression: string;
  span: IRSpan;
}

export interface IRPolicy {
  id: string;
  name: string;
  identity: IRIdentity;
  parameters: IRParameter[];
  branches: IRPolicyBranch[];
  span: IRSpan;
}

export interface IRLock {
  id: string;
  source: string;
  parameterId?: string;
  entityId: string;
  mode: "share" | "update";
  order: number;
}

export interface IREffect {
  kind: "create" | "update";
  target: string;
  entityId: string;
  assignments: { fieldId: string; fieldName: string; expression: IRExpression }[];
}

export interface IRAction {
  id: string;
  name: string;
  identity: IRIdentity;
  parameters: IRParameter[];
  callerParameterId: string;
  callableParameters: string[];
  returnEntityId: string;
  authorization: IRRule;
  preconditions: IRRule[];
  idempotency?: {
    mode: "required";
    scope: "authenticatedPrincipal";
    replay: "storedResult";
    fingerprint: "canonicalSha256";
  };
  effect: IREffect;
  lockPlan: IRLock[];
  span: IRSpan;
  naming: { sqlFunction: string; typescriptMethod: string };
}

export interface IRQuery {
  id: string;
  name: string;
  identity: IRIdentity;
  parameters: IRParameter[];
  callerParameterId: string;
  callableParameters: string[];
  sourceEntityId: string;
  rowAlias: string;
  authorization: IRRule;
  rowPolicy: IRRule;
  orderBy: {
    fieldId: string;
    direction: "asc" | "desc";
    identityTieBreaker: true;
  };
  limit: number;
  span: IRSpan;
  naming: { sqlFunction: string; typescriptMethod: string };
}

export interface IRWorkflowTransition {
  id: string;
  name: string;
  identity: IRIdentity;
  fromMemberId: string;
  toMemberId: string;
  actionId: string;
  span: IRSpan;
}

export interface IRWorkflow {
  id: string;
  name: string;
  identity: IRIdentity;
  entityId: string;
  fieldId: string;
  enumId: string;
  initialMemberId: string;
  transitions: IRWorkflowTransition[];
  span: IRSpan;
  naming: {
    sqlTriggerFunction: string;
    sqlInsertTrigger: string;
    sqlUpdateTrigger: string;
    typescriptName: string;
  };
}

export interface EnforcementEntry {
  id: string;
  purpose: string;
  layer: string;
  artifact: string;
  objectName: string;
  source?: IRSpan;
}

export interface ModelIR {
  irVersion: 11;
  model: {
    id: string;
    name: string;
    version: string;
    sourceHash: string;
    sourceFile: string;
    naming: { sqlSchema: string; internalSchema: string };
  };
  principal: { entityId: string; bindingMechanism: "session_user" };
  enums: IREnum[];
  entities: IREntity[];
  policies: IRPolicy[];
  actions: IRAction[];
  queries: IRQuery[];
  workflows: IRWorkflow[];
  enforcement: EnforcementEntry[];
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
