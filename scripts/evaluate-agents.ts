import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  scoreAgentEvaluation,
  type AgentEvaluationReplay,
  type AgentEvaluationSuite,
} from "../src/agent-evaluation.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const suitePath = argument("--suite", "evaluation/agent/scenarios.json");
  const replayPath = argument("--replay", "evaluation/agent/fixtures/scoring-smoke.json");
  const [suiteValue, replayValue, suiteSchema, replaySchema] = await Promise.all([
    json(suitePath),
    json(replayPath),
    json("schemas/agent-evaluation-suite.schema.json"),
    json("schemas/agent-evaluation-replay.schema.json"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateSuite = ajv.compile<AgentEvaluationSuite>(suiteSchema as AnySchema);
  const validateReplay = ajv.compile<AgentEvaluationReplay>(replaySchema as AnySchema);
  if (!validateSuite(suiteValue)) throw new Error(`Invalid agent evaluation suite: ${JSON.stringify(validateSuite.errors)}`);
  if (!validateReplay(replayValue)) throw new Error(`Invalid agent evaluation replay: ${JSON.stringify(validateReplay.errors)}`);
  const report = scoreAgentEvaluation(
    suiteValue as AgentEvaluationSuite,
    replayValue as AgentEvaluationReplay,
  );
  if (process.argv.includes("--check")) {
    process.stdout.write(`OK ${report.suiteId} (${(suiteValue as AgentEvaluationSuite).scenarios.length} scenarios, ${report.conditions.length} conditions, ${report.observations.length} observations; non-empirical)\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
