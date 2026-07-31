import type {
  IRAction,
  IREntity,
  IREnum,
  IRPolicy,
  IRQuery,
  IRWorkflow,
  ModelIR,
} from "./ir.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";

export type SemanticChangeClassification =
  | "additive"
  | "restrictive"
  | "expansive"
  | "breaking"
  | "review";

export type SemanticChangeArea =
  | "identity"
  | "structure"
  | "validation"
  | "authorization"
  | "queryVisibility"
  | "lifecycle"
  | "effect"
  | "persistence";

export interface SemanticChange {
  kind: string;
  area: SemanticChangeArea;
  classification: SemanticChangeClassification;
  subject: { kind: string; id: string; name: string };
  before?: string;
  after?: string;
  persistenceRisk: boolean;
  explanation: string;
}

export interface SemanticDiff {
  $schema: "https://modellang.dev/schemas/semantic-diff.schema.json";
  diffVersion: 3;
  compilerVersion: string;
  irVersion: 10;
  previous: { modelId: string; version: string; sourceHash: string };
  current: { modelId: string; version: string; sourceHash: string };
  changes: SemanticChange[];
  summary: Record<SemanticChangeClassification, number>;
  migrationAuthority: "separateGuardedMigrationPlanners";
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== "object") return value;
  const ignored = new Set(["span", "sourceExpression", "naming", "fieldName", "memberName"]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .map(([key, child]) => [key, normalized(child)]));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function text(value: unknown): string {
  return JSON.stringify(normalized(value));
}

function subject(kind: string, value: { id: string; name: string }): SemanticChange["subject"] {
  return { kind, id: value.id, name: value.name };
}

function addChange(changes: SemanticChange[], change: SemanticChange): void {
  changes.push(change);
}

function compareNamed<T extends { id: string; name: string }>(
  changes: SemanticChange[],
  kind: string,
  previous: T,
  current: T,
  persistenceRisk = false,
): void {
  if (previous.name === current.name) return;
  addChange(changes, {
    kind: "identityPreservingRename",
    area: "identity",
    classification: persistenceRisk ? "review" : "additive",
    subject: subject(kind, current),
    before: previous.name,
    after: current.name,
    persistenceRisk,
    explanation: persistenceRisk
      ? "The stable identity is preserved, but a stored or exported representation may require migration."
      : "The stable identity is preserved while the editable declaration name changes.",
  });
}

function pairById<T extends { id: string; name: string }>(
  changes: SemanticChange[],
  kind: string,
  previous: T[],
  current: T[],
  area: SemanticChangeArea,
  addedClassification: SemanticChangeClassification = "additive",
  removedClassification: SemanticChangeClassification = "breaking",
  persistenceRisk = area === "structure" || area === "persistence" || area === "lifecycle",
): { previous: T; current: T }[] {
  const previousById = new Map(previous.map((value) => [value.id, value]));
  const currentById = new Map(current.map((value) => [value.id, value]));
  for (const value of current) {
    if (previousById.has(value.id)) continue;
    addChange(changes, {
      kind: "declarationAdded",
      area,
      classification: addedClassification,
      subject: subject(kind, value),
      after: value.name,
      persistenceRisk,
      explanation: `A new ${kind} declaration was added.`,
    });
  }
  for (const value of previous) {
    if (currentById.has(value.id)) continue;
    addChange(changes, {
      kind: "declarationRemoved",
      area,
      classification: removedClassification,
      subject: subject(kind, value),
      before: value.name,
      persistenceRisk,
      explanation: `The ${kind} declaration or its stable identity was removed.`,
    });
  }
  return current.flatMap((currentValue) => {
    const previousValue = previousById.get(currentValue.id);
    return previousValue ? [{ previous: previousValue, current: currentValue }] : [];
  });
}

function compareFields(changes: SemanticChange[], previous: IREntity, current: IREntity): void {
  for (const pair of pairById(changes, "field", previous.fields, current.fields, "structure")) {
    compareNamed(changes, "field", pair.previous, pair.current);
    const previousShape = {
      type: pair.previous.type,
      optional: pair.previous.optional,
      default: pair.previous.default,
      annotations: pair.previous.annotations,
      storage: pair.previous.storage,
      generation: pair.previous.generation,
      mutability: pair.previous.mutability,
    };
    const currentShape = {
      type: pair.current.type,
      optional: pair.current.optional,
      default: pair.current.default,
      annotations: pair.current.annotations,
      storage: pair.current.storage,
      generation: pair.current.generation,
      mutability: pair.current.mutability,
    };
    if (!same(previousShape, currentShape)) addChange(changes, {
      kind: "fieldContractChanged",
      area: "structure",
      classification: "review",
      subject: subject("field", pair.current),
      before: text(previousShape),
      after: text(currentShape),
      persistenceRisk: true,
      explanation: "The field's type, validity, storage, generation, or mutability contract changed.",
    });
  }
}

function compareInvariants(changes: SemanticChange[], previous: IREntity, current: IREntity): void {
  for (const pair of pairById(changes, "invariant", previous.invariants, current.invariants, "validation", "restrictive", "breaking", true)) {
    compareNamed(changes, "invariant", pair.previous, pair.current);
    if (!same(pair.previous.expression, pair.current.expression)) addChange(changes, {
      kind: "invariantChanged",
      area: "validation",
      classification: "review",
      subject: subject("invariant", pair.current),
      before: pair.previous.sourceExpression,
      after: pair.current.sourceExpression,
      persistenceRisk: true,
      explanation: "The valid-state predicate changed; implication cannot be proven by the current diff analyzer.",
    });
  }
}

function compareExclusions(changes: SemanticChange[], previous: IREntity, current: IREntity): void {
  for (const pair of pairById(changes, "temporalExclusion", previous.temporalExclusions, current.temporalExclusions, "validation", "restrictive", "breaking", true)) {
    compareNamed(changes, "temporalExclusion", pair.previous, pair.current);
    if (!same(pair.previous, pair.current)) addChange(changes, {
      kind: "temporalExclusionChanged",
      area: "validation",
      classification: "review",
      subject: subject("temporalExclusion", pair.current),
      before: pair.previous.sourceExpression,
      after: pair.current.sourceExpression,
      persistenceRisk: true,
      explanation: "The temporal conflict contract changed.",
    });
  }
}

function compareEnums(changes: SemanticChange[], previous: IREnum[], current: IREnum[]): void {
  for (const pair of pairById(changes, "enum", previous, current, "structure")) {
    compareNamed(changes, "enum", pair.previous, pair.current);
    for (const memberPair of pairById(changes, "enumMember", pair.previous.members, pair.current.members, "structure")) {
      compareNamed(changes, "enumMember", memberPair.previous, memberPair.current, true);
    }
  }
}

function booleanLiteral(rule: { expression: unknown }): boolean | undefined {
  const expression = rule.expression as { kind?: string; value?: unknown };
  return expression.kind === "literal" && typeof expression.value === "boolean" ? expression.value : undefined;
}

function authorizationClassification(previous: { expression: unknown }, current: { expression: unknown }): SemanticChangeClassification {
  const before = booleanLiteral(previous);
  const after = booleanLiteral(current);
  if (before === true && after !== true) return "restrictive";
  if (before !== true && after === true) return "expansive";
  if (before === false && after !== false) return "expansive";
  if (before !== false && after === false) return "restrictive";
  return "review";
}

function operationShape(operation: IRAction | IRQuery): unknown {
  return operation.callableParameters.map((id) => {
    const parameter = operation.parameters.find((candidate) => candidate.id === id)!;
    return { name: parameter.name, type: parameter.type };
  });
}

function comparePreconditions(changes: SemanticChange[], previous: IRAction, current: IRAction): void {
  const previousById = new Map(previous.preconditions.map((rule) => [rule.id, rule]));
  const currentById = new Map(current.preconditions.map((rule) => [rule.id, rule]));
  for (const rule of current.preconditions) {
    const prior = previousById.get(rule.id);
    if (!prior) addChange(changes, {
      kind: "preconditionAdded",
      area: "validation",
      classification: "restrictive",
      subject: { kind: "precondition", id: rule.id, name: rule.name },
      after: rule.sourceExpression,
      persistenceRisk: false,
      explanation: "A new action precondition narrows the set of accepted executions.",
    });
    else if (!same(prior.expression, rule.expression)) addChange(changes, {
      kind: "preconditionChanged",
      area: "validation",
      classification: "review",
      subject: { kind: "precondition", id: rule.id, name: rule.name },
      before: prior.sourceExpression,
      after: rule.sourceExpression,
      persistenceRisk: false,
      explanation: "The precondition changed; implication cannot be proven by the current diff analyzer.",
    });
  }
  for (const rule of previous.preconditions) {
    if (currentById.has(rule.id)) continue;
    addChange(changes, {
      kind: "preconditionRemoved",
      area: "validation",
      classification: "expansive",
      subject: { kind: "precondition", id: rule.id, name: rule.name },
      before: rule.sourceExpression,
      persistenceRisk: false,
      explanation: "Removing an action precondition expands the set of accepted executions.",
    });
  }
}

function compareActions(changes: SemanticChange[], previous: IRAction[], current: IRAction[]): void {
  for (const pair of pairById(changes, "action", previous, current, "structure", "additive", "breaking", false)) {
    compareNamed(changes, "action", pair.previous, pair.current);
    if (!same(operationShape(pair.previous), operationShape(pair.current))
      || pair.previous.returnEntityId !== pair.current.returnEntityId) addChange(changes, {
      kind: "operationShapeChanged",
      area: "structure",
      classification: "breaking",
      subject: subject("action", pair.current),
      before: text({ input: operationShape(pair.previous), output: pair.previous.returnEntityId }),
      after: text({ input: operationShape(pair.current), output: pair.current.returnEntityId }),
      persistenceRisk: false,
      explanation: "The callable input or output contract changed.",
    });
    if (!same(pair.previous.authorization.expression, pair.current.authorization.expression)) addChange(changes, {
      kind: "authorizationChanged",
      area: "authorization",
      classification: authorizationClassification(pair.previous.authorization, pair.current.authorization),
      subject: subject("action", pair.current),
      before: pair.previous.authorization.sourceExpression,
      after: pair.current.authorization.sourceExpression,
      persistenceRisk: false,
      explanation: "Action authority changed; only literal allow/deny changes are directionally classified automatically.",
    });
    comparePreconditions(changes, pair.previous, pair.current);
    if (!same(pair.previous.effect, pair.current.effect)) addChange(changes, {
      kind: "effectChanged",
      area: "effect",
      classification: "review",
      subject: subject("action", pair.current),
      before: text(pair.previous.effect),
      after: text(pair.current.effect),
      persistenceRisk: true,
      explanation: "The action's target, effect kind, or assignments changed.",
    });
  }
}

function compareQueries(changes: SemanticChange[], previous: IRQuery[], current: IRQuery[]): void {
  for (const pair of pairById(changes, "query", previous, current, "structure", "additive", "breaking", false)) {
    compareNamed(changes, "query", pair.previous, pair.current);
    if (!same(operationShape(pair.previous), operationShape(pair.current))
      || pair.previous.sourceEntityId !== pair.current.sourceEntityId) addChange(changes, {
      kind: "operationShapeChanged",
      area: "structure",
      classification: "breaking",
      subject: subject("query", pair.current),
      before: text({ input: operationShape(pair.previous), output: pair.previous.sourceEntityId }),
      after: text({ input: operationShape(pair.current), output: pair.current.sourceEntityId }),
      persistenceRisk: false,
      explanation: "The callable query input or result entity changed.",
    });
    if (!same(pair.previous.authorization.expression, pair.current.authorization.expression)) addChange(changes, {
      kind: "authorizationChanged",
      area: "authorization",
      classification: authorizationClassification(pair.previous.authorization, pair.current.authorization),
      subject: subject("query", pair.current),
      before: pair.previous.authorization.sourceExpression,
      after: pair.current.authorization.sourceExpression,
      persistenceRisk: false,
      explanation: "Query-level authority changed.",
    });
    if (!same(pair.previous.rowPolicy.expression, pair.current.rowPolicy.expression)) addChange(changes, {
      kind: "rowVisibilityChanged",
      area: "queryVisibility",
      classification: authorizationClassification(pair.previous.rowPolicy, pair.current.rowPolicy),
      subject: subject("query", pair.current),
      before: pair.previous.rowPolicy.sourceExpression,
      after: pair.current.rowPolicy.sourceExpression,
      persistenceRisk: false,
      explanation: "The query's row-visibility predicate changed.",
    });
    const previousResult = { orderBy: pair.previous.orderBy, limit: pair.previous.limit };
    const currentResult = { orderBy: pair.current.orderBy, limit: pair.current.limit };
    if (!same(previousResult, currentResult)) addChange(changes, {
      kind: "queryResultContractChanged",
      area: "queryVisibility",
      classification: same(pair.previous.orderBy, pair.current.orderBy)
        ? (pair.current.limit < pair.previous.limit ? "restrictive" : "expansive")
        : "review",
      subject: subject("query", pair.current),
      before: text(previousResult),
      after: text(currentResult),
      persistenceRisk: false,
      explanation: "Query ordering or maximum result cardinality changed.",
    });
  }
}

function compareWorkflows(changes: SemanticChange[], previous: IRWorkflow[], current: IRWorkflow[]): void {
  for (const pair of pairById(changes, "workflow", previous, current, "lifecycle")) {
    compareNamed(changes, "workflow", pair.previous, pair.current);
    const previousTarget = {
      entityId: pair.previous.entityId,
      fieldId: pair.previous.fieldId,
      enumId: pair.previous.enumId,
      initialMemberId: pair.previous.initialMemberId,
    };
    const currentTarget = {
      entityId: pair.current.entityId,
      fieldId: pair.current.fieldId,
      enumId: pair.current.enumId,
      initialMemberId: pair.current.initialMemberId,
    };
    if (!same(previousTarget, currentTarget)) addChange(changes, {
      kind: "workflowContractChanged",
      area: "lifecycle",
      classification: "breaking",
      subject: subject("workflow", pair.current),
      before: text(previousTarget),
      after: text(currentTarget),
      persistenceRisk: true,
      explanation: "The workflow target or initial-state contract changed.",
    });
    for (const transitionPair of pairById(
      changes,
      "transition",
      pair.previous.transitions,
      pair.current.transitions,
      "lifecycle",
      "expansive",
      "restrictive",
    )) {
      compareNamed(changes, "transition", transitionPair.previous, transitionPair.current);
      const previousEdge = {
        fromMemberId: transitionPair.previous.fromMemberId,
        toMemberId: transitionPair.previous.toMemberId,
        actionId: transitionPair.previous.actionId,
      };
      const currentEdge = {
        fromMemberId: transitionPair.current.fromMemberId,
        toMemberId: transitionPair.current.toMemberId,
        actionId: transitionPair.current.actionId,
      };
      if (!same(previousEdge, currentEdge)) addChange(changes, {
        kind: "transitionChanged",
        area: "lifecycle",
        classification: "review",
        subject: subject("transition", transitionPair.current),
        before: text(previousEdge),
        after: text(currentEdge),
        persistenceRisk: true,
        explanation: "The legal edge or its bound action changed.",
      });
    }
  }
}

function comparePolicies(changes: SemanticChange[], previous: IRPolicy[], current: IRPolicy[]): void {
  for (const pair of pairById(changes, "policy", previous, current, "authorization", "additive", "breaking", false)) {
    compareNamed(changes, "policy", pair.previous, pair.current);
    const previousParameters = pair.previous.parameters.map(({ id, name, type }) => ({ id, name, type }));
    const currentParameters = pair.current.parameters.map(({ id, name, type }) => ({ id, name, type }));
    if (!same(previousParameters, currentParameters)) addChange(changes, {
      kind: "policySignatureChanged",
      area: "authorization",
      classification: "breaking",
      subject: subject("policy", pair.current),
      before: text(previousParameters),
      after: text(currentParameters),
      persistenceRisk: false,
      explanation: "The reusable policy parameter contract changed.",
    });
    for (const branchPair of pairById(changes, "policyBranch", pair.previous.branches, pair.current.branches, "authorization", "review", "review", false)) {
      compareNamed(changes, "policyBranch", branchPair.previous, branchPair.current);
      if (!same(branchPair.previous.expression, branchPair.current.expression)) addChange(changes, {
        kind: "policyBranchChanged",
        area: "authorization",
        classification: "review",
        subject: subject("policyBranch", branchPair.current),
        before: branchPair.previous.sourceExpression,
        after: branchPair.current.sourceExpression,
        persistenceRisk: false,
        explanation: "The authority branch changed; implication and overlap cannot be proven by the current analyzer.",
      });
    }
  }
}

export function semanticDiff(previous: ModelIR, current: ModelIR): SemanticDiff {
  const changes: SemanticChange[] = [];
  if (previous.model.id !== current.model.id) addChange(changes, {
    kind: "modelIdentityChanged",
    area: "identity",
    classification: "breaking",
    subject: { kind: "model", id: current.model.id, name: current.model.name },
    before: previous.model.id,
    after: current.model.id,
    persistenceRisk: true,
    explanation: "The model identity changed; declarations cannot be assumed to belong to one evolution history.",
  });
  compareEnums(changes, previous.enums, current.enums);
  for (const pair of pairById(changes, "entity", previous.entities, current.entities, "structure")) {
    compareNamed(changes, "entity", pair.previous, pair.current);
    compareFields(changes, pair.previous, pair.current);
    compareInvariants(changes, pair.previous, pair.current);
    compareExclusions(changes, pair.previous, pair.current);
  }
  comparePolicies(changes, (previous as ModelIR & { policies?: IRPolicy[] }).policies ?? [], current.policies);
  compareActions(changes, previous.actions, current.actions);
  compareQueries(changes, previous.queries, current.queries);
  compareWorkflows(changes, previous.workflows, current.workflows);
  const summary: SemanticDiff["summary"] = {
    additive: 0,
    restrictive: 0,
    expansive: 0,
    breaking: 0,
    review: 0,
  };
  for (const change of changes) summary[change.classification] += 1;
  return {
    $schema: "https://modellang.dev/schemas/semantic-diff.schema.json",
    diffVersion: 3,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    irVersion: current.irVersion,
    previous: {
      modelId: previous.model.id,
      version: previous.model.version,
      sourceHash: previous.model.sourceHash,
    },
    current: {
      modelId: current.model.id,
      version: current.model.version,
      sourceHash: current.model.sourceHash,
    },
    changes,
    summary,
    migrationAuthority: "separateGuardedMigrationPlanners",
  };
}
