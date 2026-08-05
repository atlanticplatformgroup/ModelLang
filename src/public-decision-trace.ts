import type { AgentTool, AgentToolCatalog } from "./agent-tool-catalog.js";
import type { JsonSchema } from "./task-packet.js";

export interface PublicDecisionTraceSchemas {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface PublicDecisionTraceActionContract {
  operationId: string;
  authorizationRuleId: string;
  preconditionRuleIds: string[];
  revisionRuleId: string;
}

export const PUBLIC_DECISION_TRACE_VIEW = {
  audience: "agent",
  subjectSpecific: true,
  authorizationFiltered: true,
  inputSpecific: true,
  derivedFromCurrentState: true,
  containsCurrentStateValues: false,
  containsOperationInput: false,
  containsAuthenticatedIdentity: false,
  containsExpressions: false,
  containsPolicyIds: false,
  containsAuthorityIds: false,
  containsPrivateEvidence: false,
  grantsAuthority: false,
  runtimeAuthorizationRequired: true,
} as const;

export const PUBLIC_DECISION_TRACE_CLOSURE = {
  scope: "applicability",
  currentEvaluation: true,
  executionObserved: false,
  durableEvidence: false,
  completeDecisionTrace: false,
} as const;

function actionCandidateSchema(tool: Extract<AgentTool, { kind: "action" }>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["operationId", "input"],
    properties: {
      operationId: { const: tool.id },
      input: structuredClone(tool.inputSchema),
      expectedRevision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
    },
  };
}

function decisionSchema(contract: PublicDecisionTraceActionContract): JsonSchema {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["operationId", "status", "applicable", "authority", "revision"],
        properties: {
          operationId: { const: contract.operationId },
          status: { const: "applicable" },
          applicable: { const: true },
          authority: { const: "none" },
          revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["operationId", "status", "applicable", "authority", "explanation"],
        properties: {
          operationId: { const: contract.operationId },
          status: { const: "denied" },
          applicable: { const: false },
          authority: { const: "none" },
          explanation: { const: { kind: "authorization", ruleId: contract.authorizationRuleId } },
        },
      },
      ...(contract.preconditionRuleIds.length ? [{
        type: "object",
        additionalProperties: false,
        required: ["operationId", "status", "applicable", "authority", "revision", "explanation"],
        properties: {
          operationId: { const: contract.operationId },
          status: { const: "notApplicable" },
          applicable: { const: false },
          authority: { const: "none" },
          revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
          explanation: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "ruleId"],
            properties: {
              kind: { const: "requirement" },
              ruleId: { enum: contract.preconditionRuleIds },
            },
          },
        },
      }] : []),
      {
        type: "object",
        additionalProperties: false,
        required: ["operationId", "status", "applicable", "authority", "revision", "explanation"],
        properties: {
          operationId: { const: contract.operationId },
          status: { const: "stale" },
          applicable: { const: false },
          authority: { const: "none" },
          revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
          explanation: { const: { kind: "revision", ruleId: contract.revisionRuleId } },
        },
      },
    ],
  };
}

function stages(
  contract: PublicDecisionTraceActionContract,
  authorization: "passed" | "failed",
  requirements: readonly ("passed" | "failed" | "notEvaluated")[],
  revision: "notRequested" | "matched" | "mismatched" | "notEvaluated",
): object {
  return {
    authorization: { ruleId: contract.authorizationRuleId, outcome: authorization },
    requirements: contract.preconditionRuleIds.map((ruleId, index) => ({ ruleId, outcome: requirements[index] })),
    revision: { ruleId: contract.revisionRuleId, outcome: revision },
  };
}

function traceSchema(catalog: AgentToolCatalog, contract: PublicDecisionTraceActionContract): JsonSchema {
  const passed = contract.preconditionRuleIds.map(() => "passed" as const);
  const notEvaluated = contract.preconditionRuleIds.map(() => "notEvaluated" as const);
  const notApplicableStages = contract.preconditionRuleIds.map((_, failedIndex) => stages(
    contract,
    "passed",
    contract.preconditionRuleIds.map((__, index) => index < failedIndex ? "passed" : index === failedIndex ? "failed" : "notEvaluated"),
    "notEvaluated",
  ));
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "$schema", "traceVersion", "catalogVersion", "model", "traceId", "kind", "operationId",
      "authority", "view", "freshness", "decision", "stages", "closure",
    ],
    properties: {
      $schema: { const: "https://modellang.dev/schemas/public-decision-trace.schema.json" },
      traceVersion: { const: 1 },
      catalogVersion: { const: 7 },
      model: { const: catalog.model },
      traceId: { type: "string", format: "uuid" },
      kind: { const: "applicabilityDecisionTrace" },
      operationId: { const: contract.operationId },
      authority: { const: "none" },
      view: { const: PUBLIC_DECISION_TRACE_VIEW },
      freshness: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "tracedAt", "maxAgeSeconds", "revalidate"],
        properties: {
          mode: { const: "pointInTime" },
          tracedAt: { type: "string", format: "date-time" },
          maxAgeSeconds: { const: 0 },
          revalidate: { const: "beforeReuse" },
        },
      },
      decision: decisionSchema(contract),
      stages: { type: "object" },
      closure: { const: PUBLIC_DECISION_TRACE_CLOSURE },
    },
    allOf: [
      {
        if: { type: "object", properties: { decision: { type: "object", properties: { status: { const: "denied" } }, required: ["status"] } } },
        then: { properties: { stages: { const: stages(contract, "failed", notEvaluated, "notEvaluated") } } },
      },
      {
        if: { type: "object", properties: { decision: { type: "object", properties: { status: { const: "stale" } }, required: ["status"] } } },
        then: { properties: { stages: { const: stages(contract, "passed", passed, "mismatched") } } },
      },
      {
        if: { type: "object", properties: { decision: { type: "object", properties: { status: { const: "applicable" } }, required: ["status"] } } },
        then: { properties: { stages: { enum: [stages(contract, "passed", passed, "notRequested"), stages(contract, "passed", passed, "matched")] } } },
      },
      ...contract.preconditionRuleIds.map((ruleId, index) => ({
        if: {
          type: "object",
          properties: {
            decision: {
              type: "object",
              properties: {
                status: { const: "notApplicable" },
                explanation: {
                  type: "object",
                  properties: { ruleId: { const: ruleId } },
                  required: ["ruleId"],
                },
              },
              required: ["status", "explanation"],
            },
          },
        },
        then: { properties: { stages: { const: notApplicableStages[index] } } },
      })),
    ],
  };
}

export function publicDecisionTraceActionContracts(catalog: AgentToolCatalog): PublicDecisionTraceActionContract[] {
  return catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "action" }> => tool.kind === "action").map((tool) => ({
    operationId: tool.id,
    authorizationRuleId: tool.applicability.authorizationRuleId,
    preconditionRuleIds: [...tool.applicability.preconditionRuleIds],
    revisionRuleId: tool.applicability.revisionRuleId,
  }));
}

export function generatePublicDecisionTraceSchemas(catalog: AgentToolCatalog): PublicDecisionTraceSchemas {
  const actions = catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "action" }> => tool.kind === "action");
  const contracts = publicDecisionTraceActionContracts(catalog);
  return {
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: { action: actions.length ? { oneOf: actions.map(actionCandidateSchema) } : false },
    },
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      oneOf: contracts.map((contract) => traceSchema(catalog, contract)),
    },
  };
}
