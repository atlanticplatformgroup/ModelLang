import { ModelError, type Span } from "./diagnostics.js";
import type { IRAction, IRSpan, ModelIR } from "./ir.js";

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
  requireEntry(ir, `caller:${action.name}.${caller.name}`, caller.span);
  requireEntry(ir, action.authorization.id, action.authorization.span);
  for (const precondition of action.preconditions) requireEntry(ir, precondition.id, precondition.span);
  requireEntry(ir, `effect:${action.name}`, action.span);
  for (const lock of action.lockPlan) requireEntry(ir, lock.id);
  if (action.effect.kind === "update") {
    const target = action.parameters.find((parameter) => parameter.name === action.effect.target);
    const targetLock = action.lockPlan.find((lock) => lock.parameterId === target?.id);
    if (!targetLock || targetLock.mode !== "update") fail(ir, `Update target '${action.effect.target}' lacks a FOR UPDATE lock plan entry.`, action.span);
  }
}

export function assertEnforceable(ir: ModelIR): void {
  requireEntry(ir, "boundary:principal_binding");
  requireEntry(ir, "boundary:owner_role");
  requireEntry(ir, "boundary:internal_schema");
  requireEntry(ir, "boundary:audit");
  for (const entity of ir.entities) {
    for (const field of entity.fields) {
      if (!field.optional) requireEntry(ir, `required:${entity.name}.${field.name}`, field.span);
      if (field.type.startsWith("entity:")) requireEntry(ir, `reference:${entity.name}.${field.name}`, field.span);
      if (field.type.startsWith("enum:")) requireEntry(ir, `enum-membership:${entity.name}.${field.name}`, field.span);
      if (field.default) requireEntry(ir, `default:${entity.name}.${field.name}`, field.span);
      if (field.storage === "snapshot") requireEntry(ir, `snapshot:${entity.name}.${field.name}`, field.span);
      for (const annotation of field.annotations) {
        if (annotation.name !== "snapshot") requireEntry(ir, `annotation:${entity.name}.${field.name}.${annotation.name}`, field.span);
      }
    }
    for (const invariant of entity.invariants) requireEntry(ir, invariant.id, invariant.span);
    requireEntry(ir, `boundary:${entity.name}.direct_write`, entity.span);
  }
  for (const action of ir.actions) checkAction(ir, action);
}
