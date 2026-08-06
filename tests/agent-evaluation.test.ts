import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_EVALUATION_CONDITIONS,
  runAgentEvaluation,
  scoreAgentEvaluation,
  type AgentEvaluationReplay,
  type AgentEvaluationSuite,
} from "../src/agent-evaluation.js";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("agent evaluation assurance", () => {
  it("validates the non-empirical scenario corpus, replay, and generated SML-Agent assessments", async () => {
    const [suite, replay, suiteSchema, replaySchema, assessmentSchema, procurement, reservations] = await Promise.all([
      readJson<AgentEvaluationSuite>("evaluation/agent/scenarios.json"),
      readJson<AgentEvaluationReplay>("evaluation/agent/fixtures/scoring-smoke.json"),
      readJson<object>("schemas/agent-evaluation-suite.schema.json"),
      readJson<object>("schemas/agent-evaluation-replay.schema.json"),
      readJson<object>("schemas/sml-agent-assessment.schema.json"),
      readJson<Record<string, unknown>>("generated/procurement/sml-agent-assessment.json"),
      readJson<Record<string, unknown>>("generated/reservations/sml-agent-assessment.json"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateSuite = ajv.compile(suiteSchema);
    const validateReplay = ajv.compile(replaySchema);
    const validateAssessment = ajv.compile(assessmentSchema);
    expect(validateSuite(suite), JSON.stringify(validateSuite.errors)).toBe(true);
    expect(validateReplay(replay), JSON.stringify(validateReplay.errors)).toBe(true);
    expect(validateAssessment(procurement), JSON.stringify(validateAssessment.errors)).toBe(true);
    expect(validateAssessment(reservations), JSON.stringify(validateAssessment.errors)).toBe(true);
    expect(suite).toMatchObject({ suiteVersion: 1, id: "agent-evaluation-v1", empirical: false });
    expect(replay).toMatchObject({ kind: "syntheticScoringFixture", empiricalClaim: false });
    expect(procurement).toMatchObject({
      assessmentVersion: 1,
      compilerVersion: "0.49.0",
      profile: "SML-Agent",
      overall: "partial",
      authority: "none",
      claims: { completeConformance: false, agentCompetence: false, testExecutionAttested: false },
      evaluation: {
        deterministicAdversarialSuite: "agent-adversarial-v1",
        scenarioFormatVersion: 1,
        liveModelRunsRequiredForConformance: false,
        liveModelResultsIncluded: false,
      },
      summary: { supported: 4, partial: 6, absent: 0 },
    });
    expect((procurement.criteria as { id: string }[]).map((criterion) => criterion.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `SML-Agent-${index + 1}`),
    );
  });

  it("scores every canonical context condition deterministically without making an empirical claim", async () => {
    const suite = await readJson<AgentEvaluationSuite>("evaluation/agent/scenarios.json");
    const replay = await readJson<AgentEvaluationReplay>("evaluation/agent/fixtures/scoring-smoke.json");
    const report = scoreAgentEvaluation(suite, replay);
    expect(report).toMatchObject({
      reportVersion: 1,
      empirical: false,
      interpretation: "scoringOnlyNoModelQualityClaim",
    });
    expect(report.conditions.map((condition) => condition.condition)).toEqual(AGENT_EVALUATION_CONDITIONS);
    for (const condition of report.conditions) {
      expect(condition).toMatchObject({
        observations: suite.scenarios.length,
        validPlanRate: 1,
        toolSelectionAccuracy: 1,
        effectPredictionAccuracy: 1,
        calibrationRate: 1,
        unauthorizedAttempts: 0,
        policyViolations: 0,
        tokens: null,
        latencyMilliseconds: null,
      });
    }

    const attacked = structuredClone(replay);
    attacked.observations[0]!.selectedToolIds = ["action:act_d39dbb883b5f4019b9027b85add3de47"];
    attacked.observations[0]!.unauthorizedAttempts = 1;
    const degraded = scoreAgentEvaluation(suite, attacked).conditions[0]!;
    expect(degraded.validPlanRate).toBe(5 / 6);
    expect(degraded.toolSelectionAccuracy).toBe(5 / 6);
    expect(degraded.unauthorizedAttempts).toBe(1);
  });

  it("fails closed for duplicate, incomplete, or driver-misbound evaluation observations", async () => {
    const suite = await readJson<AgentEvaluationSuite>("evaluation/agent/scenarios.json");
    const replay = await readJson<AgentEvaluationReplay>("evaluation/agent/fixtures/scoring-smoke.json");
    const duplicate = structuredClone(replay);
    duplicate.observations.push(structuredClone(duplicate.observations[0]!));
    expect(() => scoreAgentEvaluation(suite, duplicate)).toThrow(/E6906/);
    const incomplete = structuredClone(replay);
    incomplete.observations.pop();
    expect(() => scoreAgentEvaluation(suite, incomplete)).toThrow(/E6907/);
    const wrongModel = structuredClone(replay);
    wrongModel.model.sourceHash = `sha256:${"0".repeat(64)}`;
    expect(() => scoreAgentEvaluation(suite, wrongModel)).toThrow(/E6915/);
    const inconsistent = structuredClone(suite);
    inconsistent.scenarios[0]!.requiredToolIds = ["action:undeclared"];
    expect(() => scoreAgentEvaluation(inconsistent, replay)).toThrow(/E6911/);

    const contexts = AGENT_EVALUATION_CONDITIONS.map((condition) => ({ condition, artifacts: [] }));
    const observe = vi.fn(async (scenario, context) => ({
      scenarioId: scenario.id === suite.scenarios[0]!.id ? "agent-scenario:wrong-binding" : scenario.id,
      condition: context.condition,
      selectedToolIds: [],
      unauthorizedAttempts: 0,
      unnecessaryReads: 0,
      policyViolations: 0,
      completed: false,
      recognizedMissingFacts: true,
      predictedEffects: [],
    }));
    await expect(runAgentEvaluation(suite, contexts, { name: "test", version: "1", observe }))
      .rejects.toThrow(/E6909/);
  });

  it("classifies the assessment as assurance provenance rather than an authority contract", async () => {
    const provenance = await readJson<{ artifacts: { path: string; role: string }[] }>("generated/procurement/provenance.json");
    expect(provenance.artifacts).toContainEqual(expect.objectContaining({
      path: "sml-agent-assessment.json",
      role: "assurance",
    }));
  });
});
