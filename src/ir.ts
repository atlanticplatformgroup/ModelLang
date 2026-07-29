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

export type IRExpression =
  | { kind: "literal"; value: string | number | boolean; type: string; nullable: false }
  | { kind: "nullLiteral"; type: "null"; nullable: true }
  | { kind: "parameter"; parameterId: string; name: string; type: string; nullable: false }
  | { kind: "entityValue"; parameterId: string; name: string; entityId: string; type: string; nullable: false }
  | { kind: "fieldAccess"; source: string; parameter?: string; fieldId: string; fieldName: string; type: string; nullable: boolean }
  | { kind: "enumLiteral"; enumId: string; member: string; type: string; nullable: false }
  | { kind: "unary"; operator: "not"; operand: IRExpression; type: "Boolean"; nullable: boolean }
  | { kind: "binary"; operator: "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">="; left: IRExpression; right: IRExpression; type: "Boolean"; nullable: boolean; comparisonSemantics?: "entityIdentity" }
  | { kind: "nullComparison"; operator: "isNull" | "isNotNull"; operand: IRExpression; type: "Boolean"; nullable: false };

export interface IREnum {
  id: string;
  name: string;
  members: string[];
  span: IRSpan;
  naming: { sqlCheckPrefix: string; typescriptName: string };
}

export interface IRField {
  id: string;
  name: string;
  type: string;
  optional: boolean;
  default?: IRExpression;
  annotations: { name: string; value?: number }[];
  storage: "ordinary" | "snapshot";
  span: IRSpan;
  naming: { sqlColumn: string };
}

export interface IRInvariant {
  id: string;
  name: string;
  expression: IRExpression;
  sourceExpression: string;
  span: IRSpan;
  naming: { sqlConstraint: string };
}

export interface IRTemporalExclusion {
  id: string;
  name: string;
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
  parameters: IRParameter[];
  callerParameterId: string;
  callableParameters: string[];
  returnEntityId: string;
  authorization: IRRule;
  preconditions: IRRule[];
  effect: IREffect;
  lockPlan: IRLock[];
  span: IRSpan;
  naming: { sqlFunction: string; typescriptMethod: string };
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
  irVersion: 2;
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
  actions: IRAction[];
  enforcement: EnforcementEntry[];
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
