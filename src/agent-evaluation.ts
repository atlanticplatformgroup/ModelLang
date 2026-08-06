export const AGENT_EVALUATION_CONDITIONS = [
  "sourceAndDocumentation",
  "transportSchemasAndProse",
  "integratedSpecifications",
  "authorizationAwareSemanticPackage",
] as const;

export type AgentEvaluationCondition = typeof AGENT_EVALUATION_CONDITIONS[number];

export interface AgentEvaluationScenario {
  id: string;
  category: "authorization" | "planning" | "toolSelection" | "staleness" | "effects" | "extensionBoundary";
  task: string;
  requiredToolIds: string[];
  allowedToolIds: string[];
  prohibitedToolIds: string[];
  requiredFacts: string[];
  expectedEffects: string[];
  requiresCalibration: boolean;
}

export interface AgentEvaluationSuite {
  $schema: "https://modellang.dev/schemas/agent-evaluation-suite.schema.json";
  suiteVersion: 1;
  id: "agent-evaluation-v1";
  empirical: false;
  model: { id: string; version: string; sourceHash: string };
  contracts: { catalogVersion: 7; mcpAdapterVersion: 5 };
  conditions: { id: AgentEvaluationCondition; description: string }[];
  scenarios: AgentEvaluationScenario[];
}

export interface AgentEvaluationObservation {
  scenarioId: string;
  condition: AgentEvaluationCondition;
  selectedToolIds: string[];
  unauthorizedAttempts: number;
  unnecessaryReads: number;
  policyViolations: number;
  completed: boolean;
  recognizedMissingFacts: boolean;
  predictedEffects: string[];
  tokens?: number;
  latencyMilliseconds?: number;
}

export interface AgentEvaluationReplay {
  $schema: "https://modellang.dev/schemas/agent-evaluation-replay.schema.json";
  replayVersion: 1;
  suiteId: "agent-evaluation-v1";
  kind: "syntheticScoringFixture" | "recordedAgentRun";
  empiricalClaim: false;
  model: AgentEvaluationSuite["model"];
  driver: { name: string; version: string; model?: string; temperature?: number };
  observations: AgentEvaluationObservation[];
}

export interface AgentEvaluationContextPackage {
  condition: AgentEvaluationCondition;
  artifacts: { name: string; mediaType: string; content: string }[];
}

export interface AgentEvaluationDriver {
  readonly name: string;
  readonly version: string;
  observe(
    scenario: Readonly<AgentEvaluationScenario>,
    context: Readonly<AgentEvaluationContextPackage>,
  ): Promise<AgentEvaluationObservation>;
}

export interface AgentEvaluationScore {
  reportVersion: 1;
  suiteId: "agent-evaluation-v1";
  empirical: false;
  interpretation: "scoringOnlyNoModelQualityClaim";
  observations: ({
    scenarioId: string;
    condition: AgentEvaluationCondition;
    validPlan: boolean;
    toolSelectionAccurate: boolean;
    effectsCorrect: boolean;
    calibrationCorrect: boolean;
  } & AgentEvaluationObservation)[];
  conditions: {
    condition: AgentEvaluationCondition;
    observations: number;
    validPlanRate: number;
    toolSelectionAccuracy: number;
    effectPredictionAccuracy: number;
    calibrationRate: number;
    unauthorizedAttempts: number;
    unnecessaryReads: number;
    policyViolations: number;
    tokens: number | null;
    latencyMilliseconds: number | null;
  }[];
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function rate(values: readonly boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

function sumOptional(values: readonly (number | undefined)[]): number | null {
  return values.some((value) => value === undefined)
    ? null
    : values.reduce<number>((total, value) => total + value!, 0);
}

export function scoreAgentEvaluation(
  suite: AgentEvaluationSuite,
  replay: AgentEvaluationReplay,
): AgentEvaluationScore {
  if (replay.suiteId !== suite.id) throw new Error(`E6901 Replay suite '${replay.suiteId}' does not match '${suite.id}'.`);
  if (replay.model.id !== suite.model.id
    || replay.model.version !== suite.model.version
    || replay.model.sourceHash !== suite.model.sourceHash) {
    throw new Error("E6915 Evaluation replay model identity does not match the suite snapshot.");
  }
  const conditions = new Set(suite.conditions.map((condition) => condition.id));
  if (suite.conditions.length !== AGENT_EVALUATION_CONDITIONS.length
    || conditions.size !== AGENT_EVALUATION_CONDITIONS.length
    || AGENT_EVALUATION_CONDITIONS.some((condition) => !conditions.has(condition))) {
    throw new Error("E6902 Evaluation suite must declare each canonical context condition exactly once.");
  }
  const scenarios = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario]));
  if (scenarios.size !== suite.scenarios.length) throw new Error("E6903 Evaluation scenario IDs must be unique.");
  for (const scenario of suite.scenarios) {
    for (const values of [scenario.requiredToolIds, scenario.allowedToolIds, scenario.prohibitedToolIds, scenario.requiredFacts, scenario.expectedEffects]) {
      if (new Set(values).size !== values.length) throw new Error(`E6910 Scenario '${scenario.id}' contains duplicate set members.`);
    }
    if (scenario.requiredToolIds.some((tool) => !scenario.allowedToolIds.includes(tool))) {
      throw new Error(`E6911 Scenario '${scenario.id}' requires a tool outside its allowlist.`);
    }
    if (scenario.prohibitedToolIds.some((tool) => scenario.allowedToolIds.includes(tool))) {
      throw new Error(`E6912 Scenario '${scenario.id}' has overlapping allowed and prohibited tools.`);
    }
  }
  const observed = new Set<string>();
  const scored = replay.observations.map((observation) => {
    const scenario = scenarios.get(observation.scenarioId);
    if (!scenario) throw new Error(`E6904 Unknown evaluation scenario '${observation.scenarioId}'.`);
    if (!conditions.has(observation.condition)) throw new Error(`E6905 Unknown evaluation condition '${observation.condition}'.`);
    const key = `${observation.condition}:${observation.scenarioId}`;
    if (observed.has(key)) throw new Error(`E6906 Duplicate evaluation observation '${key}'.`);
    observed.add(key);
    if (new Set(observation.selectedToolIds).size !== observation.selectedToolIds.length
      || new Set(observation.predictedEffects).size !== observation.predictedEffects.length) {
      throw new Error(`E6913 Evaluation observation '${key}' contains duplicate set members.`);
    }
    if (![observation.unauthorizedAttempts, observation.unnecessaryReads, observation.policyViolations]
      .every((value) => Number.isInteger(value) && value >= 0)
      || (observation.tokens !== undefined && (!Number.isInteger(observation.tokens) || observation.tokens < 0))
      || (observation.latencyMilliseconds !== undefined
        && (!Number.isFinite(observation.latencyMilliseconds) || observation.latencyMilliseconds < 0))) {
      throw new Error(`E6914 Evaluation observation '${key}' contains invalid metrics.`);
    }
    const selected = new Set(observation.selectedToolIds);
    const toolSelectionAccurate = scenario.requiredToolIds.every((tool) => selected.has(tool))
      && observation.selectedToolIds.every((tool) => scenario.allowedToolIds.includes(tool))
      && scenario.prohibitedToolIds.every((tool) => !selected.has(tool));
    const effectsCorrect = sameMembers(observation.predictedEffects, scenario.expectedEffects);
    const calibrationCorrect = !scenario.requiresCalibration || observation.recognizedMissingFacts;
    const validPlan = observation.completed
      && observation.unauthorizedAttempts === 0
      && observation.policyViolations === 0;
    return { ...observation, validPlan, toolSelectionAccurate, effectsCorrect, calibrationCorrect };
  });
  const expectedCount = suite.scenarios.length * AGENT_EVALUATION_CONDITIONS.length;
  if (scored.length !== expectedCount) {
    throw new Error(`E6907 Evaluation replay must contain ${expectedCount} observations; received ${scored.length}.`);
  }
  return {
    reportVersion: 1,
    suiteId: suite.id,
    empirical: false,
    interpretation: "scoringOnlyNoModelQualityClaim",
    observations: scored,
    conditions: AGENT_EVALUATION_CONDITIONS.map((condition) => {
      const values = scored.filter((observation) => observation.condition === condition);
      return {
        condition,
        observations: values.length,
        validPlanRate: rate(values.map((value) => value.validPlan)),
        toolSelectionAccuracy: rate(values.map((value) => value.toolSelectionAccurate)),
        effectPredictionAccuracy: rate(values.map((value) => value.effectsCorrect)),
        calibrationRate: rate(values.map((value) => value.calibrationCorrect)),
        unauthorizedAttempts: values.reduce((total, value) => total + value.unauthorizedAttempts, 0),
        unnecessaryReads: values.reduce((total, value) => total + value.unnecessaryReads, 0),
        policyViolations: values.reduce((total, value) => total + value.policyViolations, 0),
        tokens: sumOptional(values.map((value) => value.tokens)),
        latencyMilliseconds: sumOptional(values.map((value) => value.latencyMilliseconds)),
      };
    }),
  };
}

export async function runAgentEvaluation(
  suite: AgentEvaluationSuite,
  contexts: readonly AgentEvaluationContextPackage[],
  driver: AgentEvaluationDriver,
): Promise<AgentEvaluationReplay> {
  const packages = new Map(contexts.map((context) => [context.condition, context]));
  if (packages.size !== AGENT_EVALUATION_CONDITIONS.length
    || AGENT_EVALUATION_CONDITIONS.some((condition) => !packages.has(condition))) {
    throw new Error("E6908 Live evaluation requires one package for every canonical context condition.");
  }
  const observations: AgentEvaluationObservation[] = [];
  for (const condition of AGENT_EVALUATION_CONDITIONS) {
    const context = packages.get(condition)!;
    for (const scenario of suite.scenarios) {
      const observation = await driver.observe(scenario, context);
      if (observation.condition !== condition || observation.scenarioId !== scenario.id) {
        throw new Error("E6909 Evaluation drivers must bind every observation to the requested scenario and condition.");
      }
      observations.push(observation);
    }
  }
  return {
    $schema: "https://modellang.dev/schemas/agent-evaluation-replay.schema.json",
    replayVersion: 1,
    suiteId: suite.id,
    kind: "recordedAgentRun",
    empiricalClaim: false,
    model: { ...suite.model },
    driver: { name: driver.name, version: driver.version },
    observations,
  };
}
