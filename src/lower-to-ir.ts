import type { ModelIR } from "./ir.js";
import type { ResolvedProgram } from "./resolver.js";
import { analyze } from "./type-checker.js";

export function lowerToIR(resolved: ResolvedProgram, source: string, file: string): ModelIR {
  return analyze(resolved.program, source, file);
}
