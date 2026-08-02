import type {
  IRAction,
  IRConsumer,
  IREvent,
  IRExpression,
  IRProjection,
  IRQuery,
  IRRule,
  IRSpan,
  ModelIR,
} from "./ir.js";
import type {
  ManifestErrorKind,
  ManifestOperation,
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
  manifestVersion: 12;
  profile: "sml-transactional-core/12";
  audience: "engineering";
  view: {
    authorizationFiltered: false;
    currentState: false;
    executable: false;
  };
  provenance: {
    compilerVersion: string;
    irVersion: 20;
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
  projections: SemanticProjection[];
  policies: SemanticPolicy[];
  events: SemanticEvent[];
  actions: SemanticAction[];
  consumers: SemanticConsumer[];
  queries: SemanticQuery[];
}

export interface SemanticEvent {
  id: string;
  name: string;
  source: IRSpan;
  payloadEntityId: string;
  contractSource: IREvent["source"];
  publicationFailurePolicy: IREvent["publicationFailurePolicy"];
  emittedByActionIds: string[];
  emittedByConsumerIds: string[];
  privacy: { outbox: "private"; runtimeProjection: false };
}

export interface SemanticPolicy {
  id: string;
  name: string;
  source: IRSpan;
  parameters: { id: string; name: string; type: string }[];
  evaluation: "exactlyOneBranch";
  branches: SemanticRule[];
  usedBy: { operationId: string; ruleId: string; usage: "authorization" | "precondition" | "consumerAuthorization" | "consumerPrecondition" | "queryAuthorization" | "rowPolicy" }[];
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
  reliability: {
    idempotency: "required" | "unsupported";
    scope: "authenticatedPrincipal";
    replay: "storedResult" | "none";
    durableReceipt: boolean;
    correlation: true;
  };
  emittedEventIds: string[];
  failureClasses: ManifestErrorKind[];
}

export interface SemanticProjection {
  id: string;
  name: string;
  source: IRSpan;
  sourceEntityId: string;
  fields: { id: string; name: string; sourceFieldId: string; nestedProjectionId?: string; source: IRSpan }[];
}

export interface SemanticQuery {
  id: string;
  name: string;
  source: IRSpan;
  caller: { parameterId: string; entityId: string; source: "authenticatedContext" };
  input: ManifestParameter[];
  output: { projectionId: string; cardinality: "many"; maxItems: number };
  authorization: SemanticRule;
  rowPolicy: SemanticRule;
  readSet: SemanticReadSet;
  disclosureSet: { projectionId: string; projectionIds: string[]; projectionFieldIds: string[]; sourceFieldIds: string[] };
  orderBy: { fieldId: string; direction: "asc" | "desc"; identityTieBreaker: true };
  failureClasses: ManifestErrorKind[];
}

export interface SemanticConsumer {
  id: string;
  name: string;
  source: IRSpan;
  sourceEventId: string;
  acceptedPayloadEntityId: string;
  output: { entityId: string; cardinality: "one" };
  authorization: SemanticRule;
  preconditions: SemanticRule[];
  readSet: SemanticReadSet;
  lockPlan: IRConsumer["lockPlan"];
  effect: { kind: "create" | "update"; entityId: string; assignments: { fieldId: string; expression: IRExpression }[] };
  emittedEventIds: string[];
  failurePolicy: IRConsumer["failurePolicy"];
  delivery: IRConsumer["delivery"];
  privacy: { inbox: "private"; evidence: "private"; publicCapabilityProjection: false };
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
): { input: ManifestParameter[]; output: ManifestOperation["output"]; errors: ManifestErrorKind[] } {
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
      const parameter = [
        ...ir.actions.flatMap((operation) => operation.parameters),
        ...ir.consumers.map((consumer) => consumer.payloadParameter),
        ...ir.queries.flatMap((operation) => operation.parameters),
        ...ir.policies.flatMap((operation) => operation.parameters),
      ]
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
    reliability: action.idempotency ? {
      idempotency: "required",
      scope: "authenticatedPrincipal",
      replay: "storedResult",
      durableReceipt: true,
      correlation: true,
    } : {
      idempotency: "unsupported",
      scope: "authenticatedPrincipal",
      replay: "none",
      durableReceipt: false,
      correlation: true,
    },
    emittedEventIds: [...action.emittedEventIds],
    failureClasses: operation.errors,
  };
}

function queryEntry(ir: ModelIR, manifest: OperationManifest, query: IRQuery): SemanticQuery {
  const operation = operationInput(manifest, query.id);
  if (operation.output.cardinality !== "many" || operation.output.maxItems === undefined) {
    throw new Error(`E6304 Query '${query.id}' has a non-collection output.`);
  }
  const projection = ir.projections.find((candidate) => candidate.id === query.returnProjectionId);
  if (!projection) throw new Error(`E6305 Query '${query.id}' references unknown projection '${query.returnProjectionId}'.`);
  const projectionClosure: IRProjection[] = [];
  const visited = new Set<string>();
  const visit = (current: IRProjection): void => {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    projectionClosure.push(current);
    for (const field of current.fields) {
      if (!field.nestedProjectionId) continue;
      const nested = ir.projections.find((candidate) => candidate.id === field.nestedProjectionId);
      if (!nested) throw new Error(`E6306 Projection '${current.id}' references unknown nested projection '${field.nestedProjectionId}'.`);
      visit(nested);
    }
  };
  visit(projection);
  const disclosedFields = projectionClosure.flatMap((candidate) => candidate.fields);
  const sourceReads = readSet(ir, [query.authorization, query.rowPolicy]);
  sourceReads.entityIds = [...new Set([
    ...sourceReads.entityIds,
    query.sourceEntityId,
    ...projectionClosure.map((candidate) => candidate.sourceEntityId),
  ])].sort();
  sourceReads.fieldIds = [...new Set([
    ...sourceReads.fieldIds,
    query.orderBy.fieldId,
    ...disclosedFields.map((field) => field.sourceFieldId),
  ])].sort();
  return {
    id: query.id,
    name: query.name,
    source: query.span,
    caller: caller(query, ir),
    input: operation.input,
    output: { projectionId: operation.output.projectionId, cardinality: "many", maxItems: operation.output.maxItems },
    authorization: semanticRule(query.authorization),
    rowPolicy: semanticRule(query.rowPolicy),
    readSet: sourceReads,
    disclosureSet: {
      projectionId: projection.id,
      projectionIds: projectionClosure.map((candidate) => candidate.id),
      projectionFieldIds: disclosedFields.map((field) => field.id),
      sourceFieldIds: disclosedFields.map((field) => field.sourceFieldId),
    },
    orderBy: query.orderBy,
    failureClasses: operation.errors,
  };
}

function consumerEntry(ir: ModelIR, consumer: IRConsumer): SemanticConsumer {
  return {
    id: consumer.id,
    name: consumer.name,
    source: consumer.span,
    sourceEventId: consumer.sourceEventId,
    acceptedPayloadEntityId: consumer.acceptedPayloadEntityId,
    output: { entityId: consumer.returnEntityId, cardinality: "one" },
    authorization: semanticRule(consumer.authorization),
    preconditions: consumer.preconditions.map(semanticRule),
    readSet: readSet(ir, [consumer.authorization, ...consumer.preconditions], consumer.effect.assignments.map((assignment) => assignment.expression)),
    lockPlan: consumer.lockPlan,
    effect: {
      kind: consumer.effect.kind,
      entityId: consumer.effect.entityId,
      assignments: consumer.effect.assignments.map((assignment) => ({ fieldId: assignment.fieldId, expression: assignment.expression })),
    },
    emittedEventIds: [...consumer.emittedEventIds],
    failurePolicy: consumer.failurePolicy,
    delivery: consumer.delivery,
    privacy: { inbox: "private", evidence: "private", publicCapabilityProjection: false },
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
    for (const consumer of ir.consumers) {
      if (has(consumer.authorization.expression)) result.push({ operationId: consumer.id, ruleId: consumer.authorization.id, usage: "consumerAuthorization" });
      for (const rule of consumer.preconditions) if (has(rule.expression)) result.push({ operationId: consumer.id, ruleId: rule.id, usage: "consumerPrecondition" });
    }
    for (const query of ir.queries) {
      if (has(query.authorization.expression)) result.push({ operationId: query.id, ruleId: query.authorization.id, usage: "queryAuthorization" });
      if (has(query.rowPolicy.expression)) result.push({ operationId: query.id, ruleId: query.rowPolicy.id, usage: "rowPolicy" });
    }
    return result;
  };
  return {
    $schema: "https://modellang.dev/schemas/semantic-manifest.schema.json",
    manifestVersion: 12,
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
    projections: ir.projections.map((projection) => ({
      id: projection.id,
      name: projection.name,
      source: projection.span,
      sourceEntityId: projection.sourceEntityId,
      fields: projection.fields.map((field) => ({
        id: field.id,
        name: field.name,
        sourceFieldId: field.sourceFieldId,
        ...(field.nestedProjectionId ? { nestedProjectionId: field.nestedProjectionId } : {}),
        source: field.span,
      })),
    })),
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
        execution: uses(policy.id).some((use) => use.usage === "authorization" || use.usage === "precondition"
          || use.usage === "consumerAuthorization" || use.usage === "consumerPrecondition"),
        durableEvidence: uses(policy.id).some((use) => use.usage === "authorization" || use.usage === "consumerAuthorization"),
      },
    })),
    events: ir.events.map((event) => ({
      id: event.id,
      name: event.name,
      source: event.span,
      payloadEntityId: event.payloadEntityId,
      contractSource: event.source,
      publicationFailurePolicy: event.publicationFailurePolicy,
      emittedByActionIds: ir.actions.filter((action) => action.emittedEventIds.includes(event.id)).map((action) => action.id),
      emittedByConsumerIds: ir.consumers.filter((consumer) => consumer.emittedEventIds.includes(event.id)).map((consumer) => consumer.id),
      privacy: { outbox: "private", runtimeProjection: false },
    })),
    actions: ir.actions.map((action) => actionEntry(ir, operations, action)),
    consumers: ir.consumers.map((consumer) => consumerEntry(ir, consumer)),
    queries: ir.queries.map((query) => queryEntry(ir, operations, query)),
  };
}

export type { IRExpression, IRSpan, OperationValueType };
