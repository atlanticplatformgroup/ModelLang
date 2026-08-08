import type { ModelIR } from "./ir.js";
import type { AgentToolCatalog } from "./agent-tool-catalog.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";

export type SmlAgentCriterionStatus = "supported" | "partial" | "absent";

export interface SmlAgentAssessmentCriterion {
  id: `SML-Agent-${number}`;
  requirement: string;
  status: SmlAgentCriterionStatus;
  evidence: string[];
  gaps: string[];
}

export interface SmlAgentAssessment {
  $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/sml-agent-assessment.schema.json";
  assessmentVersion: 1;
  compilerVersion: string;
  profile: "SML-Agent";
  profileDefinition: "docs/whitepaper/THE_SEMANTIC_MODEL_LAYER.md#b2-agent-profile-sml-agent";
  scope: "generatedModelAdapter";
  model: AgentToolCatalog["model"];
  overall: "partial";
  authority: "none";
  claims: {
    completeConformance: false;
    agentCompetence: false;
    testExecutionAttested: false;
  };
  evaluation: {
    deterministicAdversarialSuite: "agent-adversarial-v1";
    scenarioFormatVersion: 1;
    liveModelRunsRequiredForConformance: false;
    liveModelResultsIncluded: false;
  };
  criteria: SmlAgentAssessmentCriterion[];
  summary: { supported: number; partial: number; absent: number };
}

function criterion(
  id: SmlAgentAssessmentCriterion["id"],
  requirement: string,
  status: SmlAgentCriterionStatus,
  evidence: string[],
  gaps: string[],
): SmlAgentAssessmentCriterion {
  return { id, requirement, status, evidence, gaps };
}

export function generateSmlAgentAssessment(
  ir: ModelIR,
  catalog: AgentToolCatalog,
): SmlAgentAssessment {
  const criteria: SmlAgentAssessmentCriterion[] = [
    criterion(
      "SML-Agent-1",
      "Authorization-aware semantic view rather than unconditional full-model access",
      "partial",
      ["agent-tools.json#subjectView", "POST /agent/capabilities", "POST /agent/task-packets"],
      ["Static tool discovery is intentionally not authorization-filtered", "Query and extension discovery are not subject-specific"],
    ),
    criterion(
      "SML-Agent-2",
      "Stable capability identity across model, transport, and audit records",
      "partial",
      ["model.ir.json stable IDs", "operations.json", "agent-tools.json", "mcp.json", "PostgreSQL action/query evidence"],
      ir.extensions.length > 0
        ? ["Host extension evidence and downstream audit correlation are not generated or attested"]
        : ["Packet and public-trace results are deliberately non-durable and are not audit records"],
    ),
    criterion(
      "SML-Agent-3",
      "Exact input and output schemas",
      "supported",
      ["agent-tools.json exact JSON Schema 2020-12 documents", "mcp.json", "openapi.json", "generated HTTP and MCP validators"],
      [],
    ),
    criterion(
      "SML-Agent-4",
      "Non-executing applicability semantics that identify missing facts and failed conditions",
      "partial",
      ["POST action applicability", "subject capability view v1", "public decision trace v1"],
      ["Missing required input is reported as validation rather than a modeled missing-fact plan", "Observation relevance is caller-selected rather than proven"],
    ),
    criterion(
      "SML-Agent-5",
      "Declared effects, failure classes, reversibility, and idempotency where relevant",
      "partial",
      ["operation manifest v11 failures/reliability/events", "agent task packet v1 effect summary", "extension declared effects/reliability"],
      ["Complete state-write and external-effect closure is not published", "Reversibility, compensation, and recovery closure are absent", "Host extension effects are declared but not verified"],
    ),
    criterion(
      "SML-Agent-6",
      "Links to current business-state resources separate from the static model",
      ir.queries.length > 0 ? "supported" : "absent",
      ir.queries.length > 0 ? ["agent resource envelope v1", "catalog query resource bindings", "MCP embedded query resources"] : [],
      ir.queries.length > 0 ? [] : ["The model declares no query-backed current-state resource"],
    ),
    criterion(
      "SML-Agent-7",
      "Version and freshness information",
      "supported",
      ["Model/catalog/contract versions", "zero-age resource, packet, and trace freshness", "no-store current-state and execution HTTP/MCP metadata"],
      [],
    ),
    criterion(
      "SML-Agent-8",
      "Runtime enforcement independent of agent-visible metadata",
      "supported",
      ["Authenticated generated HTTP/MCP runtime", "PostgreSQL authorization, policies, locks, invariants, revisions, and validation", "host-required extension authorization"],
      [],
    ),
    criterion(
      "SML-Agent-9",
      "Decision traces sufficient for safe allow/deny explanation",
      "partial",
      ["public decision trace v1 ordered applicability outcomes", "private exact successful-execution evidence"],
      ["Public traces are applicability-only, non-historical, and do not observe execution", "Complete or cross-service decision traces are absent"],
    ),
    criterion(
      "SML-Agent-10",
      "Tests for unauthorized, stale, adversarial, and partially informed agent behavior",
      "partial",
      ["agent-adversarial-v1 deterministic suite contract", "HTTP/MCP and live PostgreSQL conformance tests", "agent evaluation scenario format v1"],
      ["This generated assessment does not attest that tests were executed", "Live language-model evaluation is optional, stochastic, and not included"],
    ),
  ];
  const count = (status: SmlAgentCriterionStatus) => criteria.filter((item) => item.status === status).length;
  return {
    $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/sml-agent-assessment.schema.json",
    assessmentVersion: 1,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    profile: "SML-Agent",
    profileDefinition: "docs/whitepaper/THE_SEMANTIC_MODEL_LAYER.md#b2-agent-profile-sml-agent",
    scope: "generatedModelAdapter",
    model: { ...catalog.model },
    overall: "partial",
    authority: "none",
    claims: {
      completeConformance: false,
      agentCompetence: false,
      testExecutionAttested: false,
    },
    evaluation: {
      deterministicAdversarialSuite: "agent-adversarial-v1",
      scenarioFormatVersion: 1,
      liveModelRunsRequiredForConformance: false,
      liveModelResultsIncluded: false,
    },
    criteria,
    summary: { supported: count("supported"), partial: count("partial"), absent: count("absent") },
  };
}
