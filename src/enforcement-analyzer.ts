import { ModelError, type Span } from "./diagnostics.js";
import type { IRAction, IRQuery, IRSpan, IRWorkflow, ModelIR } from "./ir.js";
import { isMoneyType, moneyProfileFromType } from "./money.js";

function sourceSpan(span: IRSpan): Span {
  return {
    start: { offset: 0, line: span.line, column: span.column },
    end: { offset: 0, line: span.endLine, column: span.endColumn },
  };
}

function fail(ir: ModelIR, message: string, span?: IRSpan): never {
  throw new ModelError("E3001", message, span ? sourceSpan(span) : {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  }, span?.file ?? ir.model.sourceFile);
}

function requireEntry(ir: ModelIR, id: string, span?: IRSpan): void {
  if (!ir.enforcement.some((entry) => entry.id === id)) fail(ir, `Rule or boundary '${id}' has no supported enforcement target.`, span);
}

function checkAction(ir: ModelIR, action: IRAction): void {
  const caller = action.parameters.find((parameter) => parameter.id === action.callerParameterId);
  if (!caller || !caller.caller) fail(ir, `Action '${action.name}' has no resolved semantic caller.`, action.span);
  if (action.callableParameters.includes(action.callerParameterId)) fail(ir, `Action '${action.name}' exposes its caller in the callable ABI.`, action.span);
  const expectedCallable = action.parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id);
  if (JSON.stringify(action.callableParameters) !== JSON.stringify(expectedCallable)) {
    fail(ir, `Action '${action.name}' callable parameters are not an exact caller-free signature.`, action.span);
  }
  requireEntry(ir, `caller:${action.id}.${caller.name}`, caller.span);
  for (const parameter of action.parameters.filter((candidate) => isMoneyType(candidate.type))) {
    if (!moneyProfileFromType(parameter.type)) fail(ir, `Action '${action.name}' has an invalid money parameter type.`, parameter.span);
    requireEntry(ir, `money-parameter:${parameter.id}`, parameter.span);
  }
  requireEntry(ir, action.authorization.id, action.authorization.span);
  for (const precondition of action.preconditions) requireEntry(ir, precondition.id, precondition.span);
  if (action.effects.length === 0) fail(ir, `Action '${action.name}' has no effects.`, action.span);
  if (action.effects.at(-1)?.entityId !== action.returnEntityId) fail(ir, `Action '${action.name}' final effect does not produce its return entity.`, action.span);
  const updateTargets = new Set<string>();
  for (const effect of action.effects) {
    requireEntry(ir, effect.id, action.span);
    const effectEntity = ir.entities.find((entity) => entity.id === effect.entityId);
    if (!effectEntity) fail(ir, `Action '${action.name}' has an unknown effect entity.`, action.span);
    for (const assignment of effect.assignments) {
      const field = effectEntity.fields.find((candidate) => candidate.id === assignment.fieldId);
      if (!field) fail(ir, `Action '${action.name}' assigns an unknown field.`, action.span);
      if (field.generation) fail(ir, `Action '${action.name}' assigns database-generated field '${field.name}'.`, action.span);
      if (effect.kind === "update" && field.mutability === "immutable") {
        fail(ir, `Action '${action.name}' updates immutable field '${field.name}'.`, action.span);
      }
    }
    if (effect.kind === "update") {
      const target = action.parameters.find((parameter) => parameter.name === effect.target);
      if (!target || updateTargets.has(target.id)) fail(ir, `Update target '${effect.target}' is invalid or repeated.`, action.span);
      updateTargets.add(target.id);
      const targetLock = action.lockPlan.find((lock) => lock.parameterId === target.id);
      if (!targetLock || targetLock.mode !== "update") fail(ir, `Update target '${effect.target}' lacks a FOR UPDATE lock plan entry.`, action.span);
    }
  }
  for (const lock of action.lockPlan) requireEntry(ir, lock.id);
}

function checkQuery(ir: ModelIR, query: IRQuery): void {
  const caller = query.parameters.find((parameter) => parameter.id === query.callerParameterId);
  if (!caller || !caller.caller) fail(ir, `Query '${query.name}' has no resolved semantic caller.`, query.span);
  if (query.callableParameters.includes(query.callerParameterId)) fail(ir, `Query '${query.name}' exposes its caller in the callable ABI.`, query.span);
  const expectedCallable = query.parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id);
  if (JSON.stringify(query.callableParameters) !== JSON.stringify(expectedCallable)) {
    fail(ir, `Query '${query.name}' callable parameters are not an exact caller-free signature.`, query.span);
  }
  requireEntry(ir, `caller:${query.id}.${caller.name}`, caller.span);
  for (const parameter of query.parameters.filter((candidate) => isMoneyType(candidate.type))) {
    if (!moneyProfileFromType(parameter.type)) fail(ir, `Query '${query.name}' has an invalid money parameter type.`, parameter.span);
    requireEntry(ir, `money-parameter:${parameter.id}`, parameter.span);
  }
  for (const parameter of query.parameters.filter((candidate) => candidate.optional)) {
    requireEntry(ir, `optional-filter:${parameter.id}`, parameter.span);
  }
  requireEntry(ir, `boundary:${query.id}.safe_search_path`, query.span);
  requireEntry(ir, query.authorization.id, query.authorization.span);
  requireEntry(ir, query.rowPolicy.id, query.rowPolicy.span);
  for (const disclosure of query.disclosures ?? []) requireEntry(ir, disclosure.id, disclosure.span);
  requireEntry(ir, `order:${query.id}`, query.span);
  if (query.sortProfiles?.length) requireEntry(ir, `sort-profiles:${query.id}`, query.span);
  requireEntry(ir, `limit:${query.id}`, query.span);
  if (query.pagination) requireEntry(ir, `cursor:${query.id}`, query.span);
  if (query.readEvidence) requireEntry(ir, `read-evidence:${query.id}`, query.span);
  requireEntry(ir, `read:${query.id}`, query.span);
  requireEntry(ir, `disclose:${query.id}`, query.span);
  const projection = ir.projections.find((candidate) => candidate.id === query.returnProjectionId);
  if (!projection || projection.sourceEntityId !== query.sourceEntityId) {
    fail(ir, `Query '${query.name}' has an invalid disclosure projection.`, query.span);
  }
  const visited = new Set<string>();
  const checkProjection = (projectionId: string): void => {
    if (visited.has(projectionId)) return;
    visited.add(projectionId);
    const current = ir.projections.find((candidate) => candidate.id === projectionId);
    if (!current) fail(ir, `Query '${query.name}' has an unknown nested disclosure projection '${projectionId}'.`, query.span);
    const entity = ir.entities.find((candidate) => candidate.id === current.sourceEntityId);
    if (!entity) fail(ir, `Projection '${current.name}' has an unknown source entity.`, current.span);
    for (const selected of current.fields) {
      const sourceField = entity.fields.find((candidate) => candidate.id === selected.sourceFieldId);
      if (!sourceField) fail(ir, `Projection '${current.name}' has an unknown source field.`, selected.span);
      if (!selected.nestedProjectionId) continue;
      const nested = ir.projections.find((candidate) => candidate.id === selected.nestedProjectionId);
      if (!nested || sourceField.type !== nested.sourceEntityId) {
        fail(ir, `Projection '${current.name}' has an invalid nested disclosure projection.`, selected.span);
      }
      checkProjection(nested.id);
    }
  };
  checkProjection(projection.id);
}

function checkWorkflow(ir: ModelIR, workflow: IRWorkflow): void {
  const entity = ir.entities.find((candidate) => candidate.id === workflow.entityId);
  const field = entity?.fields.find((candidate) => candidate.id === workflow.fieldId);
  const enumeration = ir.enums.find((candidate) => candidate.id === workflow.enumId);
  if (!entity || !field || !enumeration || field.type !== enumeration.id || field.optional) {
    fail(ir, `Workflow '${workflow.name}' has an invalid entity, field, or enum target.`, workflow.span);
  }
  if (!enumeration.members.some((member) => member.id === workflow.initialMemberId)) {
    fail(ir, `Workflow '${workflow.name}' has an invalid initial state.`, workflow.span);
  }
  requireEntry(ir, `workflow-initial:${workflow.id}`, workflow.span);
  for (const transition of workflow.transitions) {
    if (!enumeration.members.some((member) => member.id === transition.fromMemberId)
      || !enumeration.members.some((member) => member.id === transition.toMemberId)
      || !ir.actions.some((action) => action.id === transition.actionId)) {
      fail(ir, `Workflow '${workflow.name}' has an unresolved transition '${transition.name}'.`, transition.span);
    }
    requireEntry(ir, transition.id, transition.span);
  }
}

export function assertEnforceable(ir: ModelIR): void {
  requireEntry(ir, "boundary:principal_binding");
  requireEntry(ir, "boundary:owner_role");
  requireEntry(ir, "boundary:internal_schema");
  requireEntry(ir, "boundary:migration_history");
  requireEntry(ir, "boundary:audit");
  requireEntry(ir, "boundary:decision_evidence");
  for (const policy of ir.policies) {
    requireEntry(ir, policy.id, policy.span);
    for (const branch of policy.branches) requireEntry(ir, branch.id, branch.span);
  }
  for (const entity of ir.entities) {
    for (const field of entity.fields) {
      if (isMoneyType(field.type)) {
        if (!moneyProfileFromType(field.type)) fail(ir, `Field '${entity.name}.${field.name}' has an invalid money type.`, field.span);
        requireEntry(ir, `money:${field.id}`, field.span);
      }
      if (field.generation) {
        if (field.optional || field.default || field.storage !== "ordinary" || field.mutability !== "immutable") {
          fail(ir, `Generated field '${entity.name}.${field.name}' has an invalid storage contract.`, field.span);
        }
        if ((field.generation.strategy === "uuid" && field.type !== "UUID")
          || (field.generation.strategy === "now" && field.type !== "DateTime")) {
          fail(ir, `Generated field '${entity.name}.${field.name}' has an incompatible strategy and type.`, field.span);
        }
      }
      if (!field.optional) requireEntry(ir, `required:${field.id}`, field.span);
      if (field.type.startsWith("entity:")) requireEntry(ir, `reference:${field.id}`, field.span);
      if (field.type.startsWith("enum:")) requireEntry(ir, `enum-membership:${field.id}`, field.span);
      if (field.type.startsWith("set:enum:")) requireEntry(ir, `enum-set:${field.id}`, field.span);
      if (field.default) requireEntry(ir, `default:${field.id}`, field.span);
      if (field.storage === "snapshot") requireEntry(ir, `snapshot:${field.id}`, field.span);
      if (field.generation) requireEntry(ir, `generated:${field.id}`, field.span);
      if (field.mutability === "immutable") requireEntry(ir, `immutable:${field.id}`, field.span);
      for (const annotation of field.annotations) {
        if (annotation.name !== "snapshot" && annotation.name !== "generated" && annotation.name !== "immutable") {
          requireEntry(ir, `annotation:${field.id}.${annotation.name}`, field.span);
        }
      }
    }
    for (const invariant of entity.invariants) requireEntry(ir, invariant.id, invariant.span);
    for (const exclusion of entity.temporalExclusions) {
      requireEntry(ir, exclusion.id, exclusion.span);
      requireEntry(ir, `derived:${exclusion.id}.valid_interval`, exclusion.span);
    }
    requireEntry(ir, `boundary:${entity.id}.direct_write`, entity.span);
    requireEntry(ir, `boundary:${entity.id}.direct_read`, entity.span);
  }
  for (const action of ir.actions) checkAction(ir, action);
  for (const query of ir.queries) checkQuery(ir, query);
  for (const workflow of ir.workflows) checkWorkflow(ir, workflow);
}
