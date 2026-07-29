import type { ModelIR } from "../ir.js";

function safe(value: string): string { return value.replace(/[^A-Za-z0-9_]/g, "_"); }

export function generateMermaid(ir: ModelIR): string {
  const lines = ["flowchart LR", `  identity["session_user identity binding"]`, `  principal["Principal: ${ir.principal.entityId.slice(7)}"]`, "  identity -->|binds| principal"];
  for (const entity of ir.entities) {
    lines.push(`  ${safe(entity.id)}["Entity: ${entity.name}"]`);
    for (const field of entity.fields.filter((candidate) => candidate.type.startsWith("entity:"))) {
      lines.push(`  ${safe(entity.id)} -->|${field.name}| ${safe(field.type)}`);
    }
    for (const invariant of entity.invariants) {
      lines.push(`  ${safe(invariant.id)}["Invariant: ${invariant.name}"] -->|constrains| ${safe(entity.id)}`);
    }
  }
  for (const action of ir.actions) {
    lines.push(`  ${safe(action.id)}["Action: ${action.name}"]`);
    lines.push(`  principal -->|authenticated caller| ${safe(action.id)}`);
    lines.push(`  ${safe(action.id)} -->|${action.effect.kind === "create" ? "creates" : "updates"}| ${safe(action.effect.entityId)}`);
    lines.push(`  ${safe(action.authorization.id)}["Authorize"] -->|guards| ${safe(action.id)}`);
    for (const precondition of action.preconditions) lines.push(`  ${safe(precondition.id)}["Require: ${precondition.name}"] -->|guards| ${safe(action.id)}`);
    for (const lock of action.lockPlan) lines.push(`  ${safe(action.id)} -->|locks ${lock.mode}| ${safe(lock.entityId)}`);
  }
  return `${lines.join("\n")}\n`;
}
