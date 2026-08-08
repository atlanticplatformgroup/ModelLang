import type { AgentTool, AgentToolCatalog } from "./agent-tool-catalog.js";
import { DELEGATION_MAX_TTL_SECONDS } from "./agent-routes.js";
import type { JsonSchema } from "./task-packet.js";

export interface DelegatedCapabilitySchemas {
  issueInputSchema: JsonSchema;
  issueOutputSchema: JsonSchema;
  revokeOutputSchema: JsonSchema;
}

export const DELEGATED_CAPABILITY_CONSTRAINTS = {
  operation: "exact",
  input: "canonicalSha256",
  revision: "required",
  uses: 1,
  transferable: false,
  redelegation: false,
} as const;

export const DELEGATED_CAPABILITY_VIEW = {
  audience: "agent",
  containsOperationInput: false,
  containsGrantorIdentity: false,
  containsDelegateIdentity: false,
  containsCredential: true,
  credentialDelivery: "once",
  grantsAuthority: true,
  runtimeAuthorizationRequired: true,
} as const;

function actionCandidateSchema(tool: Extract<AgentTool, { kind: "action" }>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["operationId", "input"],
    properties: {
      operationId: { const: tool.id },
      input: structuredClone(tool.inputSchema),
    },
  };
}

export function generateDelegatedCapabilitySchemas(
  catalog: AgentToolCatalog,
): DelegatedCapabilitySchemas {
  const actions = catalog.tools.filter((tool): tool is Extract<AgentTool, { kind: "action" }> => tool.kind === "action");
  const issueInputSchema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["action", "delegate", "audience", "expiresInSeconds"],
    properties: {
      action: actions.length ? { oneOf: actions.map(actionCandidateSchema) } : false,
      delegate: {
        type: "object",
        additionalProperties: false,
        required: ["issuer", "subject"],
        properties: {
          issuer: { type: "string", format: "uri", minLength: 1, maxLength: 2048 },
          subject: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
      audience: { type: "string", format: "uri", minLength: 1, maxLength: 2048 },
      expiresInSeconds: { type: "integer", minimum: 1, maximum: DELEGATION_MAX_TTL_SECONDS },
    },
  };
  const issueOutputSchema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: [
      "$schema", "delegatedCapabilityVersion", "catalogVersion", "model", "grantId",
      "operationId", "inputHash", "authority", "issuedAt", "notBefore", "expiresAt",
      "revision", "audience", "constraints", "view", "credential",
    ],
    properties: {
      $schema: { const: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/delegated-capability.schema.json" },
      delegatedCapabilityVersion: { const: 1 },
      catalogVersion: { const: 7 },
      model: { const: catalog.model },
      grantId: { type: "string", format: "uuid" },
      operationId: actions.length ? { enum: actions.map((action) => action.id) } : false,
      inputHash: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      authority: { const: "delegated" },
      issuedAt: { type: "integer", minimum: 0 },
      notBefore: { type: "integer", minimum: 0 },
      expiresAt: { type: "integer", minimum: 1 },
      revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
      audience: { type: "string", format: "uri", minLength: 1, maxLength: 2048 },
      constraints: { const: DELEGATED_CAPABILITY_CONSTRAINTS },
      view: { const: DELEGATED_CAPABILITY_VIEW },
      credential: {
        type: "object",
        additionalProperties: false,
        required: ["scheme", "secret", "delivery", "value"],
        properties: {
          scheme: { const: "ModelLang-Delegation" },
          secret: { const: true },
          delivery: { const: "once" },
          value: { type: "string", minLength: 32, maxLength: 4096 },
        },
      },
    },
  };
  const revokeOutputSchema: JsonSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["grantId", "status", "revoked"],
    properties: {
      grantId: { type: "string", format: "uuid" },
      status: { enum: ["revoked", "alreadyRevoked", "consumed", "expired", "notFound"] },
      revoked: { type: "boolean" },
    },
  };
  return { issueInputSchema, issueOutputSchema, revokeOutputSchema };
}
