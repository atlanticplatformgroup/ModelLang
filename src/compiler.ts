import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parse } from "./parser.js";
import type { ModelIR } from "./ir.js";
import { resolveProgram } from "./resolver.js";
import { lowerToIR } from "./lower-to-ir.js";
import { assertEnforceable } from "./enforcement-analyzer.js";
import { validateIR } from "./validate-ir.js";

export function compileText(source: string, file = "<source>"): ModelIR {
  const syntax = parse(source, file);
  const resolved = resolveProgram(syntax, file);
  const ir = lowerToIR(resolved, source, file);
  assertEnforceable(ir);
  validateIR(ir);
  return ir;
}

export async function compileFile(file: string): Promise<ModelIR> {
  const absolute = resolve(file);
  const relativeFile = relative(process.cwd(), absolute);
  const displayFile = !relativeFile.startsWith("..") && !isAbsolute(relativeFile) ? relativeFile : absolute;
  const source = await readFile(absolute, "utf8");
  return compileText(source, displayFile);
}
