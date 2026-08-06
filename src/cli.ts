#!/usr/bin/env node
import { resolve } from "node:path";
import { compileFile } from "./compiler.js";
import { formatDiagnostic, ModelError } from "./diagnostics.js";
import { stableJson } from "./ir.js";
import { writeGeneratedAtomically } from "./build.js";
import { enforcementText } from "./codegen/enforcement.js";
import { readFile, writeFile } from "node:fs/promises";
import type { ModelIR } from "./ir.js";
import { validateIR } from "./validate-ir.js";
import { assignStableIds } from "./stable-ids.js";
import { planMigration } from "./migrations.js";
import { semanticDiff } from "./semantic-diff.js";
import { parseReviewedMigrationPlan, planReviewedMigration } from "./reviewed-migrations.js";

const USAGE = `Usage:
  modelc <check|print-ir|explain> <file> [--debug]
  modelc build <file> --out <directory> [--agent-plugin-url <url>] [--agent-plugin-name <name>] [--debug]
  modelc assign-ids <file>
  modelc migration <previous-ir.json> <current.model> --out <migration.sql>
  modelc reviewed-migration <previous-ir.json> <current.model> --plan <reviewed-plan.json> --out <migration.sql>
  modelc semantic-diff <previous-ir.json> <current.model> --out <semantic-diff.json>
`;

function usage(exitCode = 2): never {
  (exitCode === 0 ? process.stdout : process.stderr).write(USAGE);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [command, fileArg, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h") usage(0);
  if (!command || !fileArg) usage();
  if (command === "assign-ids") {
    const file = resolve(fileArg);
    const source = await readFile(file, "utf8");
    const assigned = assignStableIds(source, file);
    if (assigned.assigned > 0) await writeFile(file, assigned.source, "utf8");
    process.stdout.write(`${assigned.assigned > 0 ? `Assigned ${assigned.assigned} stable IDs` : "All stable IDs already assigned"} in ${file}\n`);
    return;
  }
  if (command === "migration" || command === "reviewed-migration" || command === "semantic-diff") {
    const currentArg = rest[0];
    const outIndex = rest.indexOf("--out");
    if (!currentArg || outIndex < 0 || !rest[outIndex + 1]) usage();
    const previousFile = resolve(fileArg);
    const previous = JSON.parse(await readFile(previousFile, "utf8")) as ModelIR;
    validateIR(previous);
    const current = await compileFile(resolve(currentArg));
    const out = resolve(rest[outIndex + 1]!);
    if (command === "semantic-diff") {
      const report = semanticDiff(previous, current);
      await writeFile(out, stableJson(report), "utf8");
      process.stdout.write(`Generated ${report.changes.length} semantic change${report.changes.length === 1 ? "" : "s"} into ${out}\n`);
    } else if (command === "reviewed-migration") {
      const planIndex = rest.indexOf("--plan");
      if (planIndex < 0 || !rest[planIndex + 1]) usage();
      const document = parseReviewedMigrationPlan(JSON.parse(await readFile(resolve(rest[planIndex + 1]!), "utf8")));
      const reviewed = planReviewedMigration(previous, current, document);
      await writeFile(out, reviewed.sql, "utf8");
      process.stdout.write(`Generated reviewed migration ${reviewed.planHash} into ${out}\n`);
    } else {
      const plan = planMigration(previous, current);
      await writeFile(out, plan.sql, "utf8");
      process.stdout.write(`Generated ${plan.operations.length} migration operation${plan.operations.length === 1 ? "" : "s"} into ${out}\n`);
    }
    return;
  }
  if (!["check", "build", "print-ir", "explain"].includes(command)) usage();
  const file = resolve(fileArg);
  const ir = await compileFile(file);
  if (command === "check") {
    process.stdout.write(`OK ${ir.model.name} ${ir.model.version} (${ir.entities.length} entities, ${ir.actions.length} actions, ${ir.queries.length} queries, ${ir.workflows.length} workflows)\n`);
    return;
  }
  if (command === "print-ir") {
    process.stdout.write(stableJson(ir));
    return;
  }
  if (command === "explain") {
    process.stdout.write(`${enforcementText(ir)}\n`);
    return;
  }
  const outIndex = rest.indexOf("--out");
  if (outIndex < 0 || !rest[outIndex + 1]) usage();
  const out = resolve(rest[outIndex + 1]!);
  const pluginUrlIndex = rest.indexOf("--agent-plugin-url");
  const pluginNameIndex = rest.indexOf("--agent-plugin-name");
  if (pluginNameIndex >= 0 && pluginUrlIndex < 0) {
    throw new Error("--agent-plugin-name requires --agent-plugin-url");
  }
  const agentPlugin = pluginUrlIndex < 0 ? undefined : {
    endpointUrl: rest[pluginUrlIndex + 1] ?? usage(),
    ...(pluginNameIndex < 0 ? {} : { pluginName: rest[pluginNameIndex + 1] ?? usage() }),
  };
  await writeGeneratedAtomically(ir, out, agentPlugin ? { agentPlugin } : {});
  process.stdout.write(`Generated ${ir.model.name}${agentPlugin ? " with Agent Plugin package" : ""} into ${out}\n`);
}

main().catch(async (error: unknown) => {
  if (error instanceof ModelError) {
    let source: string | undefined;
    try { source = await readFile(error.file, "utf8"); } catch { /* diagnostic still has a location */ }
    process.stderr.write(`${formatDiagnostic(error, source)}\n`);
    process.exitCode = 1;
    return;
  }
  const debug = process.argv.includes("--debug");
  process.stderr.write(`E5000 ${error instanceof Error ? error.message : String(error)}\n`);
  if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
