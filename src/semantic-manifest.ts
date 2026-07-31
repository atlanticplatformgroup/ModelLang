import type {
  IRAction,
  IRExpression,
  IRQuery,
  IRRule,
  IRSpan,
  ModelIR,
} from "./ir.js";
import type {
  ManifestErrorKind,
  ManifestParameter,
  OperationManifest,
  OperationValueType,
} from "./operation-manifest.js";
import {
  MODELLANG_COMPILER_VERSION,
  MODELLANG_SEMANTIC_PROFILE,
} from "./version.js";

export type SemanticDependency =
  | { kind: "parameter"; id: string }
  | { kind: "field"; id: string }
  | { kind: "enumMember"; id: string }
  | { kind: "policy"; id: string };

export interface SemanticRule {
  id: string;
  name: string;
  expression: IRExpression;
  sourceExpression: string;
  source: IRSpan;
  dependencies: SemanticDependency[];
}

export interface SemanticReadSet {
  entityIds: string[];
  fieldIds: string[];
}

export interface SemanticManifest {
  $schema: "https://modellang.dev/schemas/semantic-manifest.schema.json";
  manifestVersion: 2;
  profile: "sml-transactional-core/2";
  audience: "engineering";
  view: {
    authorizationFiltered: false;
    currentState: false;
    executable: false;
  };
  provenance: {
    compilerVersion: string;
    irVersion: 10;
    generator: "semantic-manifest";
  };
  model: {
    id: string;
    name: string;
    version: string;
    sourceHash: string;
    sourceFile: string;
  };
  principal: {
    entityId: string;
    binding: "authenticatedContext";
    requestSupplied: false;
  };
  policies: SemanticPolicy[];
  actions: SemanticAction[];
  queries: SemanticQuery[];
}

export interface SemanticPolicy {
  id: string;
  name: string;
  source: IRSpan;
  parameters: { id: string; name: string; type: string }[];
  evaluation: "exactlyOneBranch";
  branches: SemanticRule[];
  usedBy: { operationId: string; ruleId: string; usage: "authorization" | "precondition" | "queryAuthorization" | "rowPolicy" }[];
  coverage: { applicability: boolean; execution: boolean; durableEvidence: boolean };
}

export interface SemanticAction {
  id: string;
  name: string;
  source: IRSpan;
  caller: { parameterId: string; entityId: string; source: "authenticatedContext" };
  input: ManifestParameter[];
  output: { entityId: string; cardinality: "one" };
  authorization: SemanticRule;
  preconditions: SemanticRule[];
  readSet: SemanticReadSet;
  lockPlan: {
    id: string;
    entityId: string;
    parameterId?: string;
    mode: "share" | "update";
    order: number;
  }[];
  effect: {
    kind: "create" | "update";
    entityId: string;
    targetParameterId?: string;
    assignments: { fieldId: string; expression: IRExpression }[];
  };
  postconditions: {
    invariantIds: string[];
    temporalExclusionIds: string[];
  };
  workflowTransitionIds: string[];
  failureClasses: ManifestErrorKind[];
}

export interface SemanticQuery {
  id: string;
  name: string;
  source: IRSpan;
  caller: { parameterId: string; entityId: string; source: "authenticatedContext" };
  input: ManifestParameter[];
  output: { entityId: string; cardinality: "many"; maxItems: number };
  authorization: SemanticRule;
  rowPolicy: SemanticRule;
  readSet: SemanticReadSet;
  orderBy: { fieldId: string; direction: "asc" | "desc"; identityTieBreaker: true };
  failureClasses: ManifestErrorKind[];
}

function dependencyKey(dependency: SemanticDependency): string {
  return `${dependency.kind}:${dependency.id}`;
}

function expressionDependencies(expression: IRExpression): SemanticDependency[] {
  const dependencies = new Map<string, SemanticDependency>();
  const add = (dependency: SemanticDependency) => dependencies.set(dependencyKey(dependency), dependency);
  const visit = (node: IRExpression): void => {
    switch (node.kind) {
      case "parameter":
      case "entityValue":
        add({ kind: "parameter", id: node.parameterId });
        return;
      case "fieldAccess":
        add({ kind: "field", id: node.fieldId });
        if (node.source.startsWith("parameter:")) add({ kind: "parameter", id: node.source });
        return;
      case "enumLiteral":
        add({ kind: "enumMember", id: node.memberId });
        return;
      case "policyCall":
        add({ kind: "policy", id: node.policyId });
        node.arguments.forEach(visit);
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "nullComparison":
        visit(node.operand);
        return;
      case "literal":
      case "moneyLiteral":
      case "nullLiteral":
        return;
    }
  };
  visit(expression);
  return [...dependencies.values()].sort((left, right) => dependencyKey(left).localeCompare(dependencyKey(right)));
}

function semanticRule(rule: IRRule): SemanticRule {
  return {
    id: rule.id,
    name: rule.name,
    expression: rule.expression,
    sourceExpression: rule.sourceExpression,
    source: rule.span,
    dependencies: expressionDependencies(rule.expression),
  };
}

function operationInput(
  manifest: OperationManifest,
  id: string,
): { input: ManifestParameter[]; output: { entityId: string; cardinality: "one" | "many"; maxItems?: number }; errors: ManifestErrorKind[] } {
  const operation = manifest.operations.find((candidate) => candidate.id === id);
  if (!operation) throw new Error(`E6301 Missing operation manifest entry '${id}'.`);
  return { input: operation.input, output: operation.output, errors: operation.errors };
}

function readSet(ir: ModelIR, rules: IRRule[], expressions: IRExpression[] = []): SemanticReadSet {
  const fieldIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const dependency of [
    ...rules.flatMap((rule) => expressionDependencies(rule.expression)),
    ...expressions.flatMap(expressionDependencies),
  ]) {
    if (dependency.kind === "field") {
      fieldIds.add(dependency.id);
      const entity = ir.entities.find((candidate) => candidate.fields.some((field) => field.id === dependency.id));
      if (entity) entityIds.add(entity.id);
    }
    if (dependency.kind === "parameter") {
      const parameter = [...ir.actions, ...ir.queries, ...ir.policies]
        .flatMap((operation) => operation.parameters)
        .find((candidate) => candidate.id === dependency.id);
      if (parameter?.type.startsWith("entity:")) entityIds.add(parameter.type);
    }
    if (dependency.kind === "policy") {
      const policy = ir.policies.find((candidate) => candidate.id === dependency.id);
      if (policy) {
        for (const parameter of policy.parameters) if (parameter.type.startsWith("entity:")) entityIds.add(parameter.type);
        for (const branch of policy.branches) {
          for (const child of expressionDependencies(branch.expression)) {
            if (child.kind === "field") {
              fieldIds.add(child.id);
              const entity = ir.entities.find((candidate) => candidate.fields.some((field) => field.id === child.id));
              if (entity) entityIds.add(entity.id);
            }
          }
        }
      }
    }
  }
  return {
    entityIds: [...entityIds].sort(),
    fieldIds: [...fieldIds].sort(),
  };
}

function caller(
  operation: IRAction | IRQuery,
  ir: ModelIR,
): { parameterId: string; entityId: string; source: "authenticatedContext" } {
  return {
    parameterId: operation.callerParameterId,
    entityId: ir.principal.entityId,
    source: "authenticatedContext",
  };
}

function actionEntry(ir: ModelIR, manifest: OperationManifest, action: IRAction): SemanticAction {
  const operation = operationInput(manifest, action.id);
  if (operation.output.cardinality !== "one") throw new Error(`E6302 Action '${action.id}' has a non-singular output.`);
  const entity = ir.entities.find((candidate) => candidate.id === action.effect.entityId);
  if (!entity) throw new Error(`E6303 Action '${action.id}' affects unknown entity '${action.effect.entityId}'.`);
  const target = action.effect.kind === "update"
    ? action.parameters.find((parameter) => parameter.name === action.effect.target)
    : undefined;
  return {
    id: action.id,
    name: action.name,
    source: action.span,
    caller: caller(action, ir),
    input: operation.input,
    output: { entityId: operation.output.entityId, cardinality: "one" },
    authorization: semanticRule(action.authorization),
    preconditions: action.preconditions.map(semanticRule),
    readSet: readSet(ir, [action.authorization, ...action.preconditions], action.effect.assignments.map((assignment) => assignment.expression)),
    lockPlan: action.lockPlan.map((lock) => ({
      id: lock.id,
      entityId: lock.entityId,
      ...(lock.parameterId ? { parameterId: lock.parameterId } : {}),
      mode: lock.mode,
      order: lock.order,
    })),
    effect: {
      kind: action.effect.kind,
      entityId: action.effect.entityId,
      ...(target ? { targetParameterId: target.id } : {}),
      assignments: action.effect.assignments.map((assignment) => ({
        fieldId: assignment.fieldId,
        expression: assignment.expression,
      })),
    },
    postconditions: {
      invariantIds: entity.invariants.map((invariant) => invariant.id),
      temporalExclusionIds: entity.temporalExclusions.map((exclusion) => exclusion.id),
    },
    workflowTransitionIds: ir.workflows.flatMap((workflow) => workflow.transitions)
      .filter((transition) => transition.actionId === action.id)
      .map((transition) => transition.id),
    failureClasses: operation.errors,
  };
}

function queryEntry(ir: ModelIR, manifest: OperationManifest, query: IRQuery): SemanticQuery {
  const operation = operationInput(manifest, query.id);
  if (operation.output.cardinality !== "many" || operation.output.maxItems === undefined) {
    throw new Error(`E6304 Query '${query.id}' has a non-collection output.`);
  }
  return {
    id: query.id,
    name: query.name,
    source: query.span,
    caller: caller(query, ir),
    input: operation.input,
    output: { entityId: operation.output.entityId, cardinality: "many", maxItems: operation.output.maxItems },
    authorization: semanticRule(query.authorization),
    rowPolicy: semanticRule(query.rowPolicy),
    readSet: readSet(ir, [query.authorization, query.rowPolicy]),
    orderBy: query.orderBy,
    failureClasses: operation.errors,
  };
}

export function generateSemanticManifest(ir: ModelIR, operations: OperationManifest): SemanticManifest {
  const uses = (policyId: string): SemanticPolicy["usedBy"] => {
    const result: SemanticPolicy["usedBy"] = [];
    const has = (expression: IRExpression): boolean => expressionDependencies(expression)
      .some((dependency) => dependency.kind === "policy" && dependency.id === policyId);
    for (const action of ir.actions) {
      if (has(action.authorization.expression)) result.push({ operationId: action.id, ruleId: action.authorization.id, usage: "authorization" });
      for (const rule of action.preconditions) if (has(rule.expression)) result.push({ operationId: action.id, ruleId: rule.id, usage: "precondition" });
    }
    for (const query of ir.queries) {
      if (has(query.authorization.expression)) result.push({ operationId: query.id, ruleId: query.authorization.id, usage: "queryAuthorization" });
      if (has(query.rowPolicy.expression)) result.push({ operationId: query.id, ruleId: query.rowPolicy.id, usage: "rowPolicy" });
    }
    return result;
  };
  return {
    $schema: "https://modellang.dev/schemas/semantic-manifest.schema.json",
    manifestVersion: 2,
    profile: MODELLANG_SEMANTIC_PROFILE,
    audience: "engineering",
    view: {
      authorizationFiltered: false,
      currentState: false,
      executable: false,
    },
    provenance: {
      compilerVersion: MODELLANG_COMPILER_VERSION,
      irVersion: ir.irVersion,
      generator: "semantic-manifest",
    },
    model: {
      id: ir.model.id,
      name: ir.model.name,
      version: ir.model.version,
      sourceHash: ir.model.sourceHash,
      sourceFile: ir.model.sourceFile,
    },
    principal: {
      entityId: ir.principal.entityId,
      binding: "authenticatedContext",
      requestSupplied: false,
    },
    policies: ir.policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      source: policy.span,
      parameters: policy.parameters.map(({ id, name, type }) => ({ id, name, type })),
      evaluation: "exactlyOneBranch",
      branches: policy.branches.map(semanticRule),
      usedBy: uses(policy.id),
      coverage: {
        applicability: uses(policy.id).some((use) => use.usage === "authorization" || use.usage === "precondition"),
        execution: uses(policy.id).some((use) => use.usage === "authorization" || use.usage === "precondition"),
        durableEvidence: uses(policy.id).some((use) => use.usage === "authorization"),
      },
    })),
    actions: ir.actions.map((action) => actionEntry(ir, operations, action)),
    queries: ir.queries.map((query) => queryEntry(ir, operations, query)),
  };
}

export type { IRExpression, IRSpan, OperationValueType };
