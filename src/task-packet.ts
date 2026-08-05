import type { AgentTool, AgentToolCatalog } from "./agent-tool-catalog.js";
import {
  TASK_PACKET_MAX_ACTIONS,
  TASK_PACKET_MAX_OBSERVATIONS,
} from "./agent-routes.js";
import type { OperationManifest } from "./operation-manifest.js";

export type JsonSchema = Record<string, unknown>;

export interface TaskPacketSchemas {
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface TaskPacketActionContract {
  operationId: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  errors: AgentTool["errors"];
  reliability: Extract<AgentTool, { kind: "action" }>["reliability"];
  emittedEventIds: string[];
  workflowTransitions: {
    workflowId: string;
    transitionId: string;
    fromMemberId: string;
    toMemberId: string;
    targetParameterId: string;
  }[];
}

export const TASK_PACKET_VIEW = {
  audience: "agent",
  subjectSpecific: true,
  authorizationFiltered: true,
  inputSpecific: true,
  containsCurrentState: true,
  containsOperationInput: false,
  containsObservationInput: false,
  containsRequestBindings: true,
  containsAuthenticatedIdentity: false,
  containsExpressions: false,
  containsExtensions: false,
  grantsAuthority: false,
  runtimeAuthorizationRequired: true,
} as const;

export const TASK_PACKET_CLOSURE = {
  status: "partial",
  dimensions: {
    identity: "bounded",
    type: "complete",
    applicability: "evaluated",
    effect: "bounded",
    lifecycle: "bounded",
    observation: "callerSelected",
    version: "complete",
    recovery: "absent",
  },
  gaps: [
    "declarationIdentityClosureNotPublished",
    "taskGoalNotModeled",
    "observationRelevanceNotProven",
    "stateWriteEffectsNotPublished",
    "externalEffectsNotPublished",
    "reversibilityNotPublished",
    "recoveryNotPublished",
  ],
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

function observationRequestSchema(tool: Extract<AgentTool, { kind: "query" }>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["binding", "operationId", "input"],
    properties: {
      binding: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
      operationId: { const: tool.id },
      input: structuredClone(tool.inputSchema),
    },
  };
}

function decisionSchema(operationId: string): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["operationId", "status", "applicable", "authority"],
    properties: {
      operationId: { const: operationId },
      status: { enum: ["applicable", "denied", "notApplicable", "stale"] },
      applicable: { type: "boolean" },
      authority: { const: "none" },
      revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
      explanation: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "ruleId"],
        properties: {
          kind: { enum: ["authorization", "requirement", "revision"] },
          ruleId: { type: "string", pattern: "^(authorize|require|revision):" },
        },
      },
    },
    allOf: [
      {
        if: { properties: { status: { const: "applicable" } }, required: ["status"] },
        then: {
          required: ["revision"],
          properties: { applicable: { const: true }, revision: true, explanation: false },
        },
      },
      {
        if: { properties: { status: { const: "denied" } }, required: ["status"] },
        then: {
          required: ["explanation"],
          properties: {
            applicable: { const: false },
            revision: false,
            explanation: { type: "object", properties: { kind: { const: "authorization" }, ruleId: { type: "string", pattern: "^authorize:" } } },
          },
        },
      },
      {
        if: { properties: { status: { const: "notApplicable" } }, required: ["status"] },
        then: {
          required: ["revision", "explanation"],
          properties: {
            applicable: { const: false },
            revision: true,
            explanation: { type: "object", properties: { kind: { const: "requirement" }, ruleId: { type: "string", pattern: "^require:" } } },
          },
        },
      },
      {
        if: { properties: { status: { const: "stale" } }, required: ["status"] },
        then: {
          required: ["revision", "explanation"],
          properties: {
            applicable: { const: false },
            revision: true,
            explanation: { type: "object", properties: { kind: { const: "revision" }, ruleId: { type: "string", pattern: "^revision:" } } },
          },
        },
      },
    ],
  };
}

function resourceSchema(catalog: AgentToolCatalog, tool: Extract<AgentTool, { kind: "query" }>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["$schema", "resourceVersion", "catalogVersion", "model", "operationId", "kind", "authority", "view", "freshness", "data"],
    properties: {
      $schema: { const: "https://modellang.dev/schemas/agent-resource.schema.json" },
      resourceVersion: { const: 1 },
      catalogVersion: { const: 7 },
      model: { const: catalog.model },
      operationId: { const: tool.id },
      kind: { const: "queryResult" },
      authority: { const: "none" },
      view: {
        const: {
          audience: "agent",
          subjectSpecific: true,
          authorizationFiltered: true,
          containsCurrentState: true,
          containsInput: false,
          containsAuthenticatedIdentity: false,
          containsExtensions: false,
          grantsAuthority: false,
          runtimeAuthorizationRequired: true,
        },
      },
      freshness: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "retrievedAt", "maxAgeSeconds", "revalidate"],
        properties: {
          mode: { const: "pointInTime" },
          retrievedAt: { type: "string", format: "date-time" },
          maxAgeSeconds: { const: 0 },
          revalidate: { const: "beforeReuse" },
        },
      },
      data: structuredClone(tool.outputSchema),
    },
  };
}

function actionPacketSchema(contract: TaskPacketActionContract): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "operationId", "name", "description", "inputSchema", "outputSchema", "errors",
      "reliability", "emittedEventIds", "workflowTransitions", "applicability",
    ],
    properties: {
      operationId: { const: contract.operationId },
      name: { const: contract.name },
      description: { const: contract.description },
      inputSchema: { const: contract.inputSchema },
      outputSchema: { const: contract.outputSchema },
      errors: { const: contract.errors },
      reliability: { const: contract.reliability },
      emittedEventIds: { const: contract.emittedEventIds },
      workflowTransitions: { const: contract.workflowTransitions },
      applicability: decisionSchema(contract.operationId),
    },
  };
}

function observationPacketSchema(
  catalog: AgentToolCatalog,
  tool: Extract<AgentTool, { kind: "query" }>,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["binding", "operationId", "resource"],
    properties: {
      binding: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
      operationId: { const: tool.id },
      resource: resourceSchema(catalog, tool),
    },
  };
}

export function taskPacketActionContracts(
  catalog: AgentToolCatalog,
  manifest: OperationManifest,
): TaskPacketActionContract[] {
  return catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "action" }> => tool.kind === "action")
    .map((tool) => ({
      operationId: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      outputSchema: structuredClone(tool.outputSchema),
      errors: [...tool.errors],
      reliability: { ...tool.reliability },
      emittedEventIds: [...tool.emittedEventIds],
      workflowTransitions: manifest.workflows.flatMap((workflow) => workflow.transitions
        .filter((transition) => transition.actionId === tool.id)
        .map((transition) => ({
          workflowId: workflow.id,
          transitionId: transition.id,
          fromMemberId: transition.fromMemberId,
          toMemberId: transition.toMemberId,
          targetParameterId: transition.target.parameterId,
        }))),
    }));
}

export function generateTaskPacketSchemas(
  catalog: AgentToolCatalog,
  manifest: OperationManifest,
): TaskPacketSchemas {
  const actions = catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "action" }> => tool.kind === "action");
  const queries = catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "query" }> => tool.kind === "query");
  const actionContracts = taskPacketActionContracts(catalog, manifest);
  const inputSchema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["actions", "observations"],
    properties: {
      actions: {
        type: "array",
        minItems: actions.length ? 1 : 0,
        maxItems: Math.min(actions.length, TASK_PACKET_MAX_ACTIONS),
        uniqueItems: true,
        items: actions.length ? { oneOf: actions.map(actionCandidateSchema) } : false,
      },
      observations: {
        type: "array",
        minItems: actions.length || !queries.length ? 0 : 1,
        maxItems: queries.length ? TASK_PACKET_MAX_OBSERVATIONS : 0,
        uniqueItems: true,
        items: queries.length ? { oneOf: queries.map(observationRequestSchema) } : false,
      },
    },
  };
  const outputSchema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: [
      "$schema", "packetVersion", "catalogVersion", "resourceVersion", "model", "packetId",
      "kind", "authority", "view", "freshness", "snapshot", "closure", "actions", "observations",
    ],
    properties: {
      $schema: { const: "https://modellang.dev/schemas/agent-task-packet.schema.json" },
      packetVersion: { const: 1 },
      catalogVersion: { const: 7 },
      resourceVersion: { const: 1 },
      model: { const: catalog.model },
      packetId: { type: "string", format: "uuid" },
      kind: { const: "boundedTaskContext" },
      authority: { const: "none" },
      view: { const: TASK_PACKET_VIEW },
      freshness: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "assembledAt", "maxAgeSeconds", "revalidate"],
        properties: {
          mode: { const: "pointInTime" },
          assembledAt: { type: "string", format: "date-time" },
          maxAgeSeconds: { const: 0 },
          revalidate: { const: "beforeReuse" },
        },
      },
      snapshot: { const: { atomic: false, observations: "independentReads" } },
      closure: { const: TASK_PACKET_CLOSURE },
      actions: {
        type: "array",
        minItems: actions.length ? 1 : 0,
        maxItems: Math.min(actions.length, TASK_PACKET_MAX_ACTIONS),
        items: actionContracts.length ? { oneOf: actionContracts.map(actionPacketSchema) } : false,
      },
      observations: {
        type: "array",
        maxItems: queries.length ? TASK_PACKET_MAX_OBSERVATIONS : 0,
        items: queries.length ? { oneOf: queries.map((tool) => observationPacketSchema(catalog, tool)) } : false,
      },
    },
  };
  return { inputSchema, outputSchema };
}
