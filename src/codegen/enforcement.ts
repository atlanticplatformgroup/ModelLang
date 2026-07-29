import type { EnforcementEntry, ModelIR } from "../ir.js";

export function generateEnforcementMarkdown(ir: ModelIR): string {
  const lines = [
    `# ${ir.model.name} enforcement map`,
    "",
    `Source hash: \`${ir.model.sourceHash}\``,
    "",
    "| Rule or mechanism | Purpose | Layer | Generated enforcement | Source |",
    "|---|---|---|---|---|",
  ];
  for (const entry of ir.enforcement) {
    const source = entry.source ? `${entry.source.file}:${entry.source.line}:${entry.source.column}` : "compiler-derived";
    lines.push(`| \`${entry.id}\` | ${escapeCell(entry.purpose)} | ${escapeCell(entry.layer)} | \`${entry.artifact}\`: \`${entry.objectName}\` | ${escapeCell(source)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function enforcementJson(ir: ModelIR): { model: ModelIR["model"]; enforcement: EnforcementEntry[] } {
  return { model: ir.model, enforcement: ir.enforcement };
}

export function enforcementText(ir: ModelIR): string {
  return ir.enforcement.map((entry) => `${entry.id}\n  ${entry.layer}: ${entry.objectName}\n  ${entry.purpose}`).join("\n\n");
}
