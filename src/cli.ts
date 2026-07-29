#!/usr/bin/env node
import { resolve } from "node:path";
import { compileFile } from "./compiler.js";
import { formatDiagnostic, ModelError } from "./diagnostics.js";
import { stableJson } from "./ir.js";
import { writeGeneratedAtomically } from "./build.js";
import { enforcementText } from "./codegen/enforcement.js";
import { readFile } from "node:fs/promises";

function usage(): never {
  process.stderr.write("Usage: modelc <check|build|print-ir|explain> <file> [--out <directory>] [--debug]\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, fileArg, ...rest] = process.argv.slice(2);
  if (!command || !fileArg || !["check", "build", "print-ir", "explain"].includes(command)) usage();
  const file = resolve(fileArg);
  const ir = await compileFile(file);
  if (command === "check") {
    process.stdout.write(`OK ${ir.model.name} ${ir.model.version} (${ir.entities.length} entities, ${ir.actions.length} actions, ${ir.queries.length} queries)\n`);
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
  await writeGeneratedAtomically(ir, out);
  process.stdout.write(`Generated ${ir.model.name} into ${out}\n`);
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
