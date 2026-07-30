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
    for (const exclusion of entity.temporalExclusions) {
      lines.push(`  ${safe(exclusion.id)}["Temporal exclusion: ${exclusion.name}"] -->|prevents overlap| ${safe(entity.id)}`);
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
  for (const query of ir.queries) {
    lines.push(`  ${safe(query.id)}["Query: ${query.name}"]`);
    lines.push(`  principal -->|authenticated caller| ${safe(query.id)}`);
    lines.push(`  ${safe(query.id)} -->|reads| ${safe(query.sourceEntityId)}`);
    lines.push(`  ${safe(query.authorization.id)}["Authorize"] -->|guards| ${safe(query.id)}`);
    lines.push(`  ${safe(query.rowPolicy.id)}["Where"] -->|filters rows| ${safe(query.id)}`);
  }
  for (const workflow of ir.workflows) {
    const enumeration = ir.enums.find((candidate) => candidate.id === workflow.enumId)!;
    const stateNode = (memberId: string) => `state_${safe(memberId)}`;
    for (const member of enumeration.members) {
      const initial = member.id === workflow.initialMemberId ? " (initial)" : "";
      lines.push(`  ${stateNode(member.id)}["State: ${member.name}${initial}"]`);
    }
    lines.push(`  ${safe(workflow.entityId)} -->|workflow ${workflow.name}| ${stateNode(workflow.initialMemberId)}`);
    for (const transition of workflow.transitions) {
      const action = ir.actions.find((candidate) => candidate.id === transition.actionId)!;
      lines.push(`  ${stateNode(transition.fromMemberId)} -->|${transition.name} via ${action.name}| ${stateNode(transition.toMemberId)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
