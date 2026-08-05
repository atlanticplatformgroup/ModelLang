import type {
  ManifestOperation,
  OperationManifest,
  OperationValueType,
} from "../operation-manifest.js";
import { operationInputName } from "../operation-manifest.js";
import type { CapabilityManifest } from "../capability-manifest.js";
import {
  SUBJECT_CAPABILITY_MAX_CANDIDATES,
  SUBJECT_CAPABILITY_ROUTE,
  TASK_PACKET_MAX_ACTIONS,
  TASK_PACKET_MAX_OBSERVATIONS,
  TASK_PACKET_ROUTE,
  DELEGATION_MAX_TTL_SECONDS,
  DELEGATION_ROUTE,
  DELEGATION_REVOKE_ROUTE_PREFIX,
  PUBLIC_DECISION_TRACE_ROUTE,
} from "../agent-routes.js";
import type { TaskPacketActionContract, TaskPacketSchemas } from "../task-packet.js";
import { TASK_PACKET_CLOSURE, TASK_PACKET_VIEW } from "../task-packet.js";
import type { DelegatedCapabilitySchemas } from "../delegated-capability.js";
import { DELEGATED_CAPABILITY_CONSTRAINTS, DELEGATED_CAPABILITY_VIEW } from "../delegated-capability.js";
import type { PublicDecisionTraceActionContract, PublicDecisionTraceSchemas } from "../public-decision-trace.js";
import { PUBLIC_DECISION_TRACE_CLOSURE, PUBLIC_DECISION_TRACE_VIEW } from "../public-decision-trace.js";
import type { AgentExtensionTool } from "../extension-tool.js";

export interface HttpOutput {
  "openapi.json": string;
  "typescript/http-client.ts": string;
  "typescript/http-server.ts": string;
  "typescript/browser.ts": string;
}

type JsonSchema = Record<string, unknown>;

export function operationRoute(operation: Pick<ManifestOperation, "id" | "kind">): string {
  const stableId = operation.id.slice(operation.id.indexOf(":") + 1);
  return `/operations/${operation.kind === "action" ? "actions" : "queries"}/${stableId}`;
}

export function applicabilityRoute(operation: Pick<ManifestOperation, "id" | "kind">): string {
  if (operation.kind !== "action") throw new Error(`E6103 Queries do not have applicability routes.`);
  return `${operationRoute(operation)}/applicability`;
}

export function agentResourceRoute(operation: Pick<ManifestOperation, "id" | "kind">): string {
  if (operation.kind !== "query") throw new Error(`E6106 Actions do not have agent resource routes.`);
  const stableId = operation.id.slice(operation.id.indexOf(":") + 1);
  return `/agent/resources/queries/${stableId}`;
}

function componentName(manifest: OperationManifest, type: OperationValueType): string {
  if (type.kind === "entity") {
    return manifest.entities.find((entity) => entity.id === type.entityId)?.name ?? "UnknownEntity";
  }
  if (type.kind === "enum" || type.kind === "enumSet") {
    return manifest.enums.find((enumeration) => enumeration.id === type.enumId)?.name ?? "UnknownEnum";
  }
  throw new Error(`E6101 Type '${type.kind}' has no component name.`);
}

function valueSchema(manifest: OperationManifest, type: OperationValueType): JsonSchema {
  if (type.kind === "entity") return { type: "string", format: "uuid" };
  if (type.kind === "enum") return { $ref: `#/components/schemas/${componentName(manifest, type)}` };
  if (type.kind === "enumSet") {
    return {
      type: "array",
      items: { $ref: `#/components/schemas/${componentName(manifest, type)}` },
      uniqueItems: true,
    };
  }
  if (type.kind === "money") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["currency", "amount"],
      properties: {
        currency: { const: type.currency },
        amount: {
          type: "string",
          pattern: `^-?(0|[1-9][0-9]*)(?:\\.[0-9]{1,${type.scale}})?$`,
          description: `Exact base-10 amount with at most ${type.precision - type.scale} integral and ${type.scale} fractional digits.`,
        },
      },
    };
  }
  return ({
    String: { type: "string" },
    Int: { type: "integer" },
    Decimal: { type: "string", pattern: "^-?(0|[1-9][0-9]*)(?:\\.[0-9]+)?$" },
    Boolean: { type: "boolean" },
    UUID: { type: "string", format: "uuid" },
    DateTime: { type: "string", format: "date-time" },
  } satisfies Record<string, JsonSchema>)[type.name];
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function operationResponses(operation: ManifestOperation): Record<string, unknown> {
  const responses = new Map<string, string>([
    ["400", "The JSON request or operation input is invalid"],
    ["401", "Authentication or principal binding failed"],
    ["403", "The authenticated caller is not authorized"],
    ["405", "The operation requires POST"],
    ["413", "The request body exceeds the configured limit"],
    ["415", "The request media type is not supported"],
    ["500", "Unexpected operation failure"],
  ]);
  if (operation.errors.includes("notFound")) responses.set("404", "A referenced entity does not exist");
  if (operation.errors.some((kind) => kind === "precondition" || kind === "transition" || kind === "conflict" || kind === "idempotency")) {
    responses.set("409", "The operation conflicts with current model state");
  }
  if (operation.errors.includes("stale")) responses.set("409", "The continuation cursor is stale");
  if (operation.errors.includes("invariant")) responses.set("422", "The result would violate a model invariant");
  return Object.fromEntries([...responses].map(([status, description]) => [
    status,
    {
      description,
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/ModelProblem" },
        },
      },
    },
  ]));
}

function applicabilityResponses(operation: ManifestOperation): Record<string, unknown> {
  const responses = operationResponses(operation);
  return Object.fromEntries(["400", "401", "405", "413", "415", "500"].map((status) => [status, responses[status]]));
}

function subjectCandidateSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  if (operation.kind !== "action") throw new Error("E6105 Subject capability candidates must be actions.");
  return {
    type: "object",
    additionalProperties: false,
    required: ["operationId", "input"],
    properties: {
      operationId: { const: operation.id },
      input: {
        type: "object",
        additionalProperties: false,
        required: operation.input.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
        properties: Object.fromEntries(operation.input.map((parameter) => [
          parameter.name,
          parameter.optional ? nullable(valueSchema(manifest, parameter.type)) : valueSchema(manifest, parameter.type),
        ])),
      },
      expectedRevision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
    },
  };
}

function operationInputSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: operation.input.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
    properties: Object.fromEntries([
      ...operation.input.map((parameter) => [parameter.name, parameter.optional
        ? nullable(valueSchema(manifest, parameter.type))
        : valueSchema(manifest, parameter.type)] as const),
      ...(operation.kind === "query" && operation.sorting
        ? [[operation.sorting.input, { type: "string", enum: operation.sorting.profiles.map((profile) => profile.name) }] as const]
        : []),
      ...(operation.kind === "query" && operation.output.cardinality === "page"
        ? [[operation.output.pagination.cursorInput, { type: "string", minLength: 1, maxLength: 4096, pattern: "^[A-Za-z0-9_-]+$" }] as const]
        : []),
    ]),
  };
}

function operationResultSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  if (operation.kind === "action") {
    const outputEntity = manifest.entities.find((entity) => entity.id === operation.output.entityId);
    if (!outputEntity) throw new Error(`E6102 Missing output entity '${operation.output.entityId}'.`);
    return { $ref: `#/components/schemas/${outputEntity.name}` };
  }
  const projection = manifest.projections.find((candidate) => candidate.id === operation.output.projectionId);
  if (!projection) throw new Error(`E6104 Missing output projection '${operation.output.projectionId}'.`);
  const items = {
    type: "array",
    maxItems: operation.output.maxItems,
    items: { $ref: `#/components/schemas/${projection.name}` },
  };
  return operation.output.cardinality === "page" ? {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items,
      nextCursor: { anyOf: [{ type: "string", minLength: 1, maxLength: 4096, pattern: "^[A-Za-z0-9_-]+$" }, { type: "null" }] },
    },
  } : items;
}

function agentResourceSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  if (operation.kind !== "query") throw new Error(`E6107 Agent resources must be query-backed.`);
  return {
    type: "object",
    additionalProperties: false,
    required: ["$schema", "resourceVersion", "catalogVersion", "model", "operationId", "kind", "authority", "view", "freshness", "data"],
    properties: {
      $schema: { const: "https://modellang.dev/schemas/agent-resource.schema.json" },
      resourceVersion: { const: 1 },
      catalogVersion: { const: 5 },
      model: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "version", "sourceHash"],
        properties: Object.fromEntries(Object.entries(manifest.model).map(([key, value]) => [key, { const: value }])),
      },
      operationId: { const: operation.id },
      kind: { const: "queryResult" },
      authority: { const: "none" },
      view: {
        type: "object",
        additionalProperties: false,
        required: ["audience", "subjectSpecific", "authorizationFiltered", "containsCurrentState", "containsInput", "containsAuthenticatedIdentity", "containsExtensions", "grantsAuthority", "runtimeAuthorizationRequired"],
        properties: {
          audience: { const: "agent" },
          subjectSpecific: { const: true },
          authorizationFiltered: { const: true },
          containsCurrentState: { const: true },
          containsInput: { const: false },
          containsAuthenticatedIdentity: { const: false },
          containsExtensions: { const: false },
          grantsAuthority: { const: false },
          runtimeAuthorizationRequired: { const: true },
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
      data: operationResultSchema(manifest, operation),
    },
  };
}

export function generateOpenApi(
  manifest: OperationManifest,
  capabilities: CapabilityManifest,
  taskPacketSchemas: TaskPacketSchemas,
  delegatedCapabilitySchemas: DelegatedCapabilitySchemas,
  publicDecisionTraceSchemas: PublicDecisionTraceSchemas,
  extensionTools: readonly AgentExtensionTool[],
): Record<string, unknown> {
  const actions = manifest.operations.filter((operation) => operation.kind === "action");
  const entitySchemas = Object.fromEntries(manifest.entities.map((entity) => [
    entity.name,
    {
      type: "object",
      additionalProperties: false,
      required: entity.fields.map((field) => field.name),
      properties: Object.fromEntries(entity.fields.map((field) => [
        field.name,
        {
          ...(field.nullable ? nullable(valueSchema(manifest, field.type)) : valueSchema(manifest, field.type)),
          ...(field.generated ? { readOnly: true } : {}),
          ...(field.snapshot ? { description: "Stored point-in-time snapshot." } : {}),
        },
      ])),
    },
  ]));
  const enumSchemas = Object.fromEntries(manifest.enums.map((enumeration) => [
    enumeration.name,
    { type: "string", enum: enumeration.members.map((member) => member.value) },
  ]));
  const projectionSchemas = Object.fromEntries(manifest.projections.map((projection) => [
    projection.name,
    {
      type: "object",
      additionalProperties: false,
      required: projection.fields.map((field) => field.name),
      properties: Object.fromEntries(projection.fields.map((field) => [
        field.name,
        {
          ...(field.nullable
            ? nullable(field.nestedProjectionId
              ? { $ref: `#/components/schemas/${manifest.projections.find((candidate) => candidate.id === field.nestedProjectionId)!.name}` }
              : valueSchema(manifest, field.type))
            : field.nestedProjectionId
              ? { $ref: `#/components/schemas/${manifest.projections.find((candidate) => candidate.id === field.nestedProjectionId)!.name}` }
              : valueSchema(manifest, field.type)),
          ...(field.redactable ? { description: "Conditionally disclosed; present as null when redacted." } : {}),
        },
      ])),
    },
  ]));
  const executionPaths = manifest.operations.map((operation) => {
    const outputSchema = operationResultSchema(manifest, operation);
    return [
      operationRoute(operation),
      {
        post: {
          operationId: operation.id.slice(operation.id.indexOf(":") + 1),
          summary: operation.name,
          tags: [operation.kind === "action" ? "Actions" : "Queries"],
          security: [{ bearerAuth: [] }],
          "x-modellang-operation-id": operation.id,
          ...(operation.kind === "query" && operation.readEvidence
            ? { "x-modellang-read-evidence": operation.readEvidence }
            : {}),
          ...(operation.kind === "action" ? {
            parameters: [
              { $ref: "#/components/parameters/DelegatedCapabilityCredential" },
              { $ref: "#/components/parameters/ExpectedRevision" },
              ...(operation.reliability.idempotency === "required" ? [{ $ref: "#/components/parameters/IdempotencyKey" }] : []),
              { $ref: "#/components/parameters/CorrelationId" },
              { $ref: "#/components/parameters/CausationId" },
            ],
            "x-modellang-idempotency": operation.reliability.idempotency,
            "x-modellang-delegated-capability": {
              version: 1,
              ordinaryBearerAuthenticationRequired: true,
              mutuallyExclusiveWithCommandMetadata: true,
            },
          } : {}),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: operationInputSchema(manifest, operation),
              },
            },
          },
          responses: {
            "200": {
              description: `${operation.name} result`,
              ...(operation.kind === "action" ? { headers: { "X-Correlation-ID": { description: "Resolved command correlation identifier", schema: { type: "string" } } } } : {}),
              content: { "application/json": { schema: outputSchema } },
            },
            ...operationResponses(operation),
          },
        },
      },
    ];
  });
  const applicabilityPaths = manifest.operations.filter((operation) => operation.kind === "action").map((operation) => [
    applicabilityRoute(operation),
    {
      post: {
        operationId: `assess_${operation.id.slice(operation.id.indexOf(":") + 1)}`,
        summary: `Assess ${operation.name}`,
        tags: ["Applicability"],
        security: [{ bearerAuth: [] }],
        "x-modellang-operation-id": operation.id,
        "x-modellang-grants-authority": false,
        parameters: [{ $ref: "#/components/parameters/ExpectedRevision" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: operation.input.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
                properties: Object.fromEntries(operation.input.map((parameter) => [parameter.name, parameter.optional
                  ? nullable(valueSchema(manifest, parameter.type))
                  : valueSchema(manifest, parameter.type)])),
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Authenticated applicability decision; this grants no authority",
            headers: { ETag: { description: "Opaque current revision when visibility permits", schema: { type: "string" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicabilityDecision" } } },
          },
          ...applicabilityResponses(operation),
        },
      },
    },
  ]);
  const resourcePaths = manifest.operations.filter((operation) => operation.kind === "query").map((operation) => [
    agentResourceRoute(operation),
    {
      post: {
        operationId: `resource_${operation.id.slice(operation.id.indexOf(":") + 1)}`,
        summary: `Read ${operation.name} as an authenticated agent resource`,
        tags: ["Agent resources"],
        security: [{ bearerAuth: [] }],
        "x-modellang-operation-id": operation.id,
        "x-modellang-grants-authority": false,
        "x-modellang-freshness": { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
        requestBody: {
          required: true,
          content: { "application/json": { schema: operationInputSchema(manifest, operation) } },
        },
        responses: {
          "200": {
            description: "Authenticated current-state query resource; this grants no authority",
            headers: { "Cache-Control": { description: "Current-state resources must not be stored", schema: { const: "no-store" } } },
            content: { "application/json": { schema: agentResourceSchema(manifest, operation) } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "413", "415", "500"].map((status) => [status, operationResponses(operation)[status]])),
        },
      },
    },
  ]);
  const subjectCapabilityPath = [
    SUBJECT_CAPABILITY_ROUTE,
    {
      post: {
        operationId: "modellang_subject_capabilities",
        summary: "Filter action tools for the authenticated subject and exact candidate inputs",
        tags: ["Agent capabilities"],
        security: [{ bearerAuth: [] }],
        "x-modellang-grants-authority": false,
        "x-modellang-input-specific": true,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["candidates"],
                properties: {
                  candidates: {
                    type: "array",
                    minItems: actions.length ? 1 : 0,
                    maxItems: Math.min(actions.length, SUBJECT_CAPABILITY_MAX_CANDIDATES),
                    uniqueItems: true,
                    items: actions.length
                      ? { oneOf: actions.map((operation) => subjectCandidateSchema(manifest, operation)) }
                      : false,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Authenticated input-specific action capability view; this grants no authority",
            headers: { "Cache-Control": { description: "Subject views must not be stored", schema: { const: "no-store" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/SubjectCapabilityView" } } },
          },
          ...Object.fromEntries(["400", "401", "405", "413", "415", "500"].map((status) => [status, operationResponses(manifest.operations[0]!)[status]])),
        },
      },
    },
  ];
  const taskPacketPath = [
    TASK_PACKET_ROUTE,
    {
      post: {
        operationId: "modellang_task_packet",
        summary: "Assemble an authenticated bounded task packet",
        tags: ["Agent task packets"],
        security: [{ bearerAuth: [] }],
        "x-modellang-grants-authority": false,
        "x-modellang-closure": "explicitPartial",
        "x-modellang-atomic": false,
        requestBody: {
          required: true,
          content: { "application/json": { schema: taskPacketSchemas.inputSchema } },
        },
        responses: {
          "200": {
            description: "Authenticated partial-closure task context; this grants no authority",
            headers: { "Cache-Control": { description: "Task packets must not be stored or reused", schema: { const: "no-store" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/AgentTaskPacket" } } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "409", "413", "415", "500"].map((status) => [
            status,
            operationResponses(manifest.operations[0]!)[status] ?? operationResponses(manifest.operations[0]!)["500"],
          ])),
        },
      },
    },
  ];
  const delegationPath = [
    DELEGATION_ROUTE,
    {
      post: {
        operationId: "modellang_issue_delegated_capability",
        summary: "Issue one exact-input delegated action capability",
        tags: ["Delegated capabilities"],
        security: [{ bearerAuth: [] }],
        "x-modellang-authority": "delegated",
        "x-modellang-max-uses": 1,
        "x-modellang-redelegation": false,
        requestBody: {
          required: true,
          content: { "application/json": { schema: delegatedCapabilitySchemas.issueInputSchema } },
        },
        responses: {
          "201": {
            description: "Single-delivery delegated bearer credential; this response is secret",
            headers: { "Cache-Control": { description: "Delegated credentials must never be stored by intermediaries", schema: { const: "no-store" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/DelegatedCapability" } } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "409", "413", "415", "500"].map((status) => [
            status,
            operationResponses(manifest.operations[0]!)[status] ?? operationResponses(manifest.operations[0]!)["500"],
          ])),
        },
      },
    },
  ];
  const delegationRevokePath = [
    `${DELEGATION_REVOKE_ROUTE_PREFIX}{grantId}/revoke`,
    {
      post: {
        operationId: "modellang_revoke_delegated_capability",
        summary: "Revoke one delegated capability as its authenticated grantor",
        tags: ["Delegated capabilities"],
        security: [{ bearerAuth: [] }],
        parameters: [{
          name: "grantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", additionalProperties: false } } },
        },
        responses: {
          "200": {
            description: "Current revocation disposition without identity disclosure",
            headers: { "Cache-Control": { description: "Revocation results must not be stored", schema: { const: "no-store" } } },
            content: { "application/json": { schema: delegatedCapabilitySchemas.revokeOutputSchema } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "413", "415", "500"].map((status) => [
            status,
            operationResponses(manifest.operations[0]!)[status] ?? operationResponses(manifest.operations[0]!)["500"],
          ])),
        },
      },
    },
  ];
  const publicDecisionTracePath = [
    PUBLIC_DECISION_TRACE_ROUTE,
    {
      post: {
        operationId: "modellang_public_decision_trace",
        summary: "Trace current authenticated action applicability without publishing values or private evidence",
        tags: ["Public decision traces"],
        security: [{ bearerAuth: [] }],
        "x-modellang-grants-authority": false,
        "x-modellang-trace-scope": "applicability",
        "x-modellang-execution-observed": false,
        "x-modellang-durable-evidence": false,
        "x-modellang-freshness": { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
        requestBody: {
          required: true,
          content: { "application/json": { schema: publicDecisionTraceSchemas.inputSchema } },
        },
        responses: {
          "200": {
            description: "Authenticated bounded applicability trace; this grants no authority and contains no state values",
            headers: { "Cache-Control": { description: "Decision traces must not be stored or reused", schema: { const: "no-store" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/PublicDecisionTrace" } } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "413", "415", "500"].map((status) => [
            status,
            operationResponses(manifest.operations[0]!)[status] ?? operationResponses(manifest.operations[0]!)["500"],
          ])),
        },
      },
    },
  ];
  const extensionPaths = extensionTools.map((tool) => [
    tool.execution.path,
    {
      post: {
        operationId: tool.id,
        summary: tool.description,
        tags: ["Host extension tools"],
        security: [{ bearerAuth: [] }],
        "x-modellang-extension-contract-version": 1,
        "x-modellang-extension-contract-revision": tool.contractRevision,
        "x-modellang-host-adapter-required": true,
        "x-modellang-generated-implementation": false,
        "x-modellang-runtime-authorization-required": true,
        "x-modellang-grants-authority": false,
        requestBody: {
          required: true,
          content: { "application/json": { schema: tool.inputSchema } },
        },
        responses: {
          "200": {
            description: "Host-authorized extension result; implementation conformance and evidence remain host responsibilities",
            headers: { "Cache-Control": { description: "Host extension results must not be stored by intermediaries", schema: { const: "no-store" } } },
            content: { "application/json": { schema: tool.outputSchema } },
          },
          ...Object.fromEntries(["400", "401", "403", "405", "413", "415", "500"].map((status) => [
            status,
            operationResponses(manifest.operations[0]!)[status] ?? operationResponses(manifest.operations[0]!)["500"],
          ])),
          "503": {
            description: "The host has not registered the exact generated extension contract revision",
            headers: { "Cache-Control": { description: "Extension availability failures must not be stored", schema: { const: "no-store" } } },
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ModelProblem" } } },
          },
        },
      },
    },
  ]);
  const paths = Object.fromEntries([
    ...executionPaths,
    ...applicabilityPaths,
    ...resourcePaths,
    subjectCapabilityPath,
    taskPacketPath,
    delegationPath,
    delegationRevokePath,
    publicDecisionTracePath,
    ...extensionPaths,
  ]);
  const safeRuleIds = capabilities.actions.flatMap((action) => [
    action.explanation.authorizationRuleId,
    ...action.explanation.preconditionRuleIds,
    action.explanation.revisionRuleId,
  ]);
  return {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: `${manifest.model.name} ModelLang API`,
      version: manifest.model.version,
      description: `Generated from ModelLang operation manifest v${manifest.manifestVersion} (${manifest.model.sourceHash}).`,
    },
    paths,
    components: {
      parameters: {
        ExpectedRevision: {
          name: "If-Match",
          in: "header",
          required: false,
          description: "Explicit opaque revision to compare; it grants no authority.",
          schema: { type: "string", pattern: '^"rev:1:[0-9a-f]{32}"$' },
        },
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Required for ordinary invocation of reliable actions and forbidden with Delegated-Capability; it grants no authority.",
          schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" },
        },
        DelegatedCapabilityCredential: {
          name: "Delegated-Capability",
          in: "header",
          required: false,
          description: "Once-delivered ModelLang-Delegation credential. It supplements ordinary bearer authentication and is mutually exclusive with caller command metadata.",
          schema: { type: "string", minLength: 32, maxLength: 4096 },
        },
        CorrelationId: {
          name: "X-Correlation-ID",
          in: "header",
          required: false,
          schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" },
        },
        CausationId: {
          name: "X-Causation-ID",
          in: "header",
          required: false,
          schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" },
        },
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ...enumSchemas,
        ...entitySchemas,
        ...projectionSchemas,
        ModelProblem: {
          type: "object",
          additionalProperties: false,
          required: ["type", "title", "status"],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer", minimum: 400, maximum: 599 },
            detail: { type: "string" },
            code: { type: "string" },
            ruleId: { type: "string" },
          },
        },
        ApplicabilityDecision: {
          type: "object",
          additionalProperties: false,
          required: ["operationId", "status", "applicable", "authority"],
          properties: {
            operationId: { type: "string", pattern: "^action:" },
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
                ruleId: safeRuleIds.length
                  ? { enum: safeRuleIds }
                  : { type: "string", pattern: "^(authorize|require|revision):" },
              },
            },
          },
          allOf: [
            {
              if: { properties: { status: { const: "applicable" } }, required: ["status"] },
              then: { properties: { applicable: { const: true } }, required: ["revision"], not: { required: ["explanation"] } },
            },
            {
              if: { properties: { status: { const: "denied" } }, required: ["status"] },
              then: {
                properties: { applicable: { const: false }, explanation: { properties: { kind: { const: "authorization" } } } },
                required: ["explanation"],
                not: { required: ["revision"] },
              },
            },
            {
              if: { properties: { status: { const: "notApplicable" } }, required: ["status"] },
              then: {
                properties: { applicable: { const: false }, explanation: { properties: { kind: { const: "requirement" } } } },
                required: ["revision", "explanation"],
              },
            },
            {
              if: { properties: { status: { const: "stale" } }, required: ["status"] },
              then: {
                properties: { applicable: { const: false }, explanation: { properties: { kind: { const: "revision" } } } },
                required: ["revision", "explanation"],
              },
            },
          ],
        },
        AgentTaskPacket: taskPacketSchemas.outputSchema,
        DelegatedCapability: delegatedCapabilitySchemas.issueOutputSchema,
        PublicDecisionTrace: publicDecisionTraceSchemas.outputSchema,
        SubjectCapabilityView: {
          type: "object",
          additionalProperties: false,
          required: ["$schema", "viewVersion", "catalogVersion", "model", "view", "authentication", "available", "unavailable"],
          properties: {
            $schema: { const: "https://modellang.dev/schemas/subject-capability-view.schema.json" },
            viewVersion: { const: 1 },
            catalogVersion: { const: 5 },
            model: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name", "version", "sourceHash"],
              properties: {
                id: { const: manifest.model.id },
                name: { const: manifest.model.name },
                version: { const: manifest.model.version },
                sourceHash: { const: manifest.model.sourceHash },
              },
            },
            view: {
              type: "object",
              additionalProperties: false,
              required: ["audience", "subjectSpecific", "authorizationFiltered", "inputSpecific", "containsExpressions", "containsResourceState", "containsExtensions", "grantsAuthority", "runtimeAuthorizationRequired"],
              properties: {
                audience: { const: "agent" },
                subjectSpecific: { const: true },
                authorizationFiltered: { const: true },
                inputSpecific: { const: true },
                containsExpressions: { const: false },
                containsResourceState: { const: false },
                containsExtensions: { const: false },
                grantsAuthority: { const: false },
                runtimeAuthorizationRequired: { const: true },
              },
            },
            authentication: {
              type: "object",
              additionalProperties: false,
              required: ["required", "source", "callerInput", "identityDisclosed"],
              properties: {
                required: { const: true },
                source: { const: "authenticatedContext" },
                callerInput: { const: false },
                identityDisclosed: { const: false },
              },
            },
            available: {
              type: "array",
              maxItems: Math.min(actions.length, SUBJECT_CAPABILITY_MAX_CANDIDATES),
              uniqueItems: true,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["operationId", "kind", "status", "applicable", "authority", "revision"],
                properties: {
                  operationId: { type: "string", pattern: "^action:" },
                  kind: { const: "action" },
                  status: { const: "applicable" },
                  applicable: { const: true },
                  authority: { const: "none" },
                  revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
                },
              },
            },
            unavailable: {
              type: "array",
              maxItems: Math.min(actions.length, SUBJECT_CAPABILITY_MAX_CANDIDATES),
              uniqueItems: true,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["operationId", "kind", "status", "applicable", "authority", "explanation"],
                properties: {
                  operationId: { type: "string", pattern: "^action:" },
                  kind: { const: "action" },
                  status: { enum: ["denied", "notApplicable", "stale"] },
                  applicable: { const: false },
                  authority: { const: "none" },
                  revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
                  explanation: {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "ruleId"],
                    properties: {
                      kind: { enum: ["authorization", "requirement", "revision"] },
                      ruleId: safeRuleIds.length
                        ? { enum: safeRuleIds }
                        : { type: "string", pattern: "^(authorize|require|revision):" },
                    },
                  },
                },
                allOf: [
                  {
                    if: { properties: { status: { const: "denied" } }, required: ["status"] },
                    then: {
                      properties: {
                        explanation: {
                          type: "object",
                          properties: {
                            kind: { const: "authorization" },
                            ruleId: { type: "string", pattern: "^authorize:" },
                          },
                        },
                        revision: false,
                      },
                    },
                  },
                  {
                    if: { properties: { status: { const: "notApplicable" } }, required: ["status"] },
                    then: {
                      properties: {
                        explanation: {
                          type: "object",
                          properties: {
                            kind: { const: "requirement" },
                            ruleId: { type: "string", pattern: "^require:" },
                          },
                        },
                        revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
                      },
                      required: ["revision"],
                    },
                  },
                  {
                    if: { properties: { status: { const: "stale" } }, required: ["status"] },
                    then: {
                      properties: {
                        explanation: {
                          type: "object",
                          properties: {
                            kind: { const: "revision" },
                            ruleId: { type: "string", pattern: "^revision:" },
                          },
                        },
                        revision: { type: "string", pattern: "^rev:1:[0-9a-f]{32}$" },
                      },
                      required: ["revision"],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

function typeImports(manifest: OperationManifest): string[] {
  return [
    ...manifest.entities.map((entity) => entity.name),
    ...manifest.projections.map((projection) => projection.name),
    ...manifest.operations.map(operationInputName),
    "ApplicabilityDecision",
    "ApplicabilityOptions",
    "ExecutionOptions",
    ...(manifest.operations.some((operation) => operation.kind === "query" && operation.output.cardinality === "page") ? ["CursorPage"] : []),
  ];
}

function returnType(manifest: OperationManifest, operation: ManifestOperation): string {
  if (operation.kind === "action") {
    const entity = manifest.entities.find((candidate) => candidate.id === operation.output.entityId);
    if (!entity) throw new Error(`E6102 Missing output entity '${operation.output.entityId}'.`);
    return entity.name;
  }
  const projection = manifest.projections.find((candidate) => candidate.id === operation.output.projectionId);
  if (!projection) throw new Error(`E6104 Missing output projection '${operation.output.projectionId}'.`);
  return operation.output.cardinality === "page" ? `CursorPage<${projection.name}>` : `${projection.name}[]`;
}

function pascalCase(value: string): string {
  return value.length ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function schemaTypeScript(schema: unknown): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "unknown";
  const value = schema as Record<string, unknown>;
  if (Array.isArray(value.anyOf)) return value.anyOf.map(schemaTypeScript).join(" | ");
  if (Object.hasOwn(value, "const")) return JSON.stringify(value.const);
  if (Array.isArray(value.enum)) return value.enum.map((item) => JSON.stringify(item)).join(" | ") || "never";
  if (value.type === "string") return "string";
  if (value.type === "integer" || value.type === "number") return "number";
  if (value.type === "boolean") return "boolean";
  if (value.type === "null") return "null";
  if (value.type === "array") return `readonly ${schemaTypeScript(value.items)}[]`;
  if (value.type === "object") {
    const properties = value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)
      ? value.properties as Record<string, unknown>
      : {};
    const required = new Set(Array.isArray(value.required) ? value.required as string[] : []);
    return `{ ${Object.entries(properties).map(([name, property]) =>
      `readonly ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${schemaTypeScript(property)}`,
    ).join("; ")} }`;
  }
  return "unknown";
}

function extensionClientTypeName(modelName: string, tool: AgentExtensionTool): string {
  return `${modelName}${pascalCase(tool.name)}Extension`;
}

function generateHttpClient(manifest: OperationManifest, extensionTools: readonly AgentExtensionTool[]): string {
  const methods = manifest.operations.map((operation) => operation.kind === "action"
    ? `  async ${operation.name}(input: ${operationInputName(operation)}, options: ExecutionOptions = {}): Promise<${returnType(manifest, operation)}> {
    return this.call(${JSON.stringify(operationRoute(operation))}, input, options);
  }`
    : `  async ${operation.name}(input: ${operationInputName(operation)}): Promise<${returnType(manifest, operation)}> {
    return this.call(${JSON.stringify(operationRoute(operation))}, input);
  }`).join("\n\n");
  const assessments = manifest.operations.filter((operation) => operation.kind === "action").map((operation) =>
    `  async assess${operation.name[0]!.toUpperCase()}${operation.name.slice(1)}(input: ${operationInputName(operation)}, options: ApplicabilityOptions = {}): Promise<ApplicabilityDecision> {
    return this.call(${JSON.stringify(applicabilityRoute(operation))}, input, { expectedRevision: options.expectedRevision });
  }`,
  ).join("\n\n");
  const resources = manifest.operations.filter((operation) => operation.kind === "query").map((operation) =>
    `  async read${operation.name[0]!.toUpperCase()}${operation.name.slice(1)}Resource(input: ${operationInputName(operation)}): Promise<${manifest.model.name}AgentResource<${returnType(manifest, operation)}, ${JSON.stringify(operation.id)}>> {
    return this.call(${JSON.stringify(agentResourceRoute(operation))}, input);
  }`,
  ).join("\n\n");
  const subjectCandidates = manifest.operations.filter((operation) => operation.kind === "action").map((operation) =>
    `  | { readonly operationId: ${JSON.stringify(operation.id)}; readonly input: ${operationInputName(operation)}; readonly expectedRevision?: string }`,
  ).join("\n");
  const delegationCandidates = manifest.operations.filter((operation) => operation.kind === "action").map((operation) =>
    `  | { readonly operationId: ${JSON.stringify(operation.id)}; readonly input: ${operationInputName(operation)} }`,
  ).join("\n");
  const taskObservations = manifest.operations.filter((operation) => operation.kind === "query").map((operation) =>
    `  | { readonly binding: string; readonly operationId: ${JSON.stringify(operation.id)}; readonly input: ${operationInputName(operation)} }`,
  ).join("\n");
  const taskObservationResults = manifest.operations.filter((operation) => operation.kind === "query").map((operation) =>
    `  | { readonly binding: string; readonly operationId: ${JSON.stringify(operation.id)}; readonly resource: ${manifest.model.name}AgentResource<${returnType(manifest, operation)}, ${JSON.stringify(operation.id)}> }`,
  ).join("\n");
  const extensionTypes = extensionTools.map((tool) => {
    const name = extensionClientTypeName(manifest.model.name, tool);
    const resultSchema = (tool.outputSchema.properties as Record<string, unknown>).result;
    return `export type ${name}Input = ${schemaTypeScript(tool.inputSchema)};

export interface ${name}Result {
  readonly $schema: "https://modellang.dev/schemas/extension-tool-result.schema.json";
  readonly extensionToolResultVersion: 1;
  readonly catalogVersion: 7;
  readonly model: ${schemaTypeScript({ type: "object", required: ["id", "name", "version", "sourceHash"], properties: {
    id: { const: manifest.model.id }, name: { const: manifest.model.name }, version: { const: manifest.model.version }, sourceHash: { const: manifest.model.sourceHash },
  } })};
  readonly extensionId: ${JSON.stringify(tool.id)};
  readonly contractRevision: ${JSON.stringify(tool.contractRevision)};
  readonly kind: "hostExtensionResult";
  readonly authority: "none";
  readonly execution: {
    readonly implementation: "hostProvided";
    readonly generatedImplementation: false;
    readonly authorization: "hostEnforced";
    readonly contractConformance: "hostAsserted";
    readonly evidence: "hostOwned";
  };
  readonly result: ${schemaTypeScript(resultSchema)};
}`;
  }).join("\n\n");
  const extensionMethods = extensionTools.map((tool) => {
    const name = extensionClientTypeName(manifest.model.name, tool);
    return `  async ${tool.name}Extension(input: ${name}Input): Promise<${name}Result> {
    return this.call(${JSON.stringify(tool.execution.path)}, input);
  }`;
  }).join("\n\n");
  return `// Generated by ModelLang. Do not edit.
import type { ${typeImports(manifest).join(", ")} } from "./types.js";
import { AuthenticationError, mapHttpProblem } from "./errors.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ${manifest.model.name}HttpClientOptions {
  baseUrl: string;
  accessToken: () => string | Promise<string>;
  fetch?: FetchLike;
  headers?: Readonly<Record<string, string>>;
}

export type ${manifest.model.name}SubjectCapabilityCandidate =
${subjectCandidates || "  never"};

export type ${manifest.model.name}TaskPacketActionCandidate =
${subjectCandidates || "  never"};

export type ${manifest.model.name}TaskPacketObservationRequest =
${taskObservations || "  never"};

export interface ${manifest.model.name}TaskPacketRequest {
  readonly actions: readonly ${manifest.model.name}TaskPacketActionCandidate[];
  readonly observations: readonly ${manifest.model.name}TaskPacketObservationRequest[];
}

export type ${manifest.model.name}DelegatedActionCandidate =
${delegationCandidates || "  never"};

export interface ${manifest.model.name}DelegationRequest {
  readonly action: ${manifest.model.name}DelegatedActionCandidate;
  readonly delegate: { readonly issuer: string; readonly subject: string };
  readonly audience: string;
  readonly expiresInSeconds: number;
}

export interface ${manifest.model.name}DelegatedCapability {
  readonly $schema: "https://modellang.dev/schemas/delegated-capability.schema.json";
  readonly delegatedCapabilityVersion: 1;
  readonly catalogVersion: 7;
  readonly model: { readonly id: string; readonly name: string; readonly version: string; readonly sourceHash: string };
  readonly grantId: string;
  readonly operationId: ${manifest.model.name}DelegatedActionCandidate["operationId"];
  readonly inputHash: string;
  readonly authority: "delegated";
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly revision: string;
  readonly audience: string;
  readonly constraints: {
    readonly operation: "exact";
    readonly input: "canonicalSha256";
    readonly revision: "required";
    readonly uses: 1;
    readonly transferable: false;
    readonly redelegation: false;
  };
  readonly view: {
    readonly audience: "agent";
    readonly containsOperationInput: false;
    readonly containsGrantorIdentity: false;
    readonly containsDelegateIdentity: false;
    readonly containsCredential: true;
    readonly credentialDelivery: "once";
    readonly grantsAuthority: true;
    readonly runtimeAuthorizationRequired: true;
  };
  readonly credential: { readonly scheme: "ModelLang-Delegation"; readonly secret: true; readonly delivery: "once"; readonly value: string };
}

export interface ${manifest.model.name}DelegationRevocation {
  readonly grantId: string;
  readonly status: "revoked" | "alreadyRevoked" | "consumed" | "expired" | "notFound";
  readonly revoked: boolean;
}

export interface ${manifest.model.name}PublicDecisionTrace {
  readonly $schema: "https://modellang.dev/schemas/public-decision-trace.schema.json";
  readonly traceVersion: 1;
  readonly catalogVersion: 7;
  readonly model: { readonly id: string; readonly name: string; readonly version: string; readonly sourceHash: string };
  readonly traceId: string;
  readonly kind: "applicabilityDecisionTrace";
  readonly operationId: ${manifest.model.name}SubjectCapabilityCandidate["operationId"];
  readonly authority: "none";
  readonly view: {
    readonly audience: "agent";
    readonly subjectSpecific: true;
    readonly authorizationFiltered: true;
    readonly inputSpecific: true;
    readonly derivedFromCurrentState: true;
    readonly containsCurrentStateValues: false;
    readonly containsOperationInput: false;
    readonly containsAuthenticatedIdentity: false;
    readonly containsExpressions: false;
    readonly containsPolicyIds: false;
    readonly containsAuthorityIds: false;
    readonly containsPrivateEvidence: false;
    readonly grantsAuthority: false;
    readonly runtimeAuthorizationRequired: true;
  };
  readonly freshness: {
    readonly mode: "pointInTime";
    readonly tracedAt: string;
    readonly maxAgeSeconds: 0;
    readonly revalidate: "beforeReuse";
  };
  readonly decision: ApplicabilityDecision;
  readonly stages: {
    readonly authorization: { readonly ruleId: string; readonly outcome: "passed" | "failed" };
    readonly requirements: readonly { readonly ruleId: string; readonly outcome: "passed" | "failed" | "notEvaluated" }[];
    readonly revision: { readonly ruleId: string; readonly outcome: "notRequested" | "matched" | "mismatched" | "notEvaluated" };
  };
  readonly closure: {
    readonly scope: "applicability";
    readonly currentEvaluation: true;
    readonly executionObserved: false;
    readonly durableEvidence: false;
    readonly completeDecisionTrace: false;
  };
}

export interface ${manifest.model.name}SubjectCapabilityView {
  readonly $schema: "https://modellang.dev/schemas/subject-capability-view.schema.json";
  readonly viewVersion: 1;
  readonly catalogVersion: 7;
  readonly model: { readonly id: string; readonly name: string; readonly version: string; readonly sourceHash: string };
  readonly view: {
    readonly audience: "agent";
    readonly subjectSpecific: true;
    readonly authorizationFiltered: true;
    readonly inputSpecific: true;
    readonly containsExpressions: false;
    readonly containsResourceState: false;
    readonly containsExtensions: false;
    readonly grantsAuthority: false;
    readonly runtimeAuthorizationRequired: true;
  };
  readonly authentication: {
    readonly required: true;
    readonly source: "authenticatedContext";
    readonly callerInput: false;
    readonly identityDisclosed: false;
  };
  readonly available: readonly {
    readonly operationId: ${manifest.model.name}SubjectCapabilityCandidate["operationId"];
    readonly kind: "action";
    readonly status: "applicable";
    readonly applicable: true;
    readonly authority: "none";
    readonly revision: string;
  }[];
  readonly unavailable: readonly {
    readonly operationId: ${manifest.model.name}SubjectCapabilityCandidate["operationId"];
    readonly kind: "action";
    readonly status: "denied" | "notApplicable" | "stale";
    readonly applicable: false;
    readonly authority: "none";
    readonly revision?: string;
    readonly explanation: { readonly kind: "authorization" | "requirement" | "revision"; readonly ruleId: string };
  }[];
}

export interface ${manifest.model.name}AgentResource<Data, OperationId extends string = string> {
  readonly $schema: "https://modellang.dev/schemas/agent-resource.schema.json";
  readonly resourceVersion: 1;
  readonly catalogVersion: 7;
  readonly model: { readonly id: string; readonly name: string; readonly version: string; readonly sourceHash: string };
  readonly operationId: OperationId;
  readonly kind: "queryResult";
  readonly authority: "none";
  readonly view: {
    readonly audience: "agent";
    readonly subjectSpecific: true;
    readonly authorizationFiltered: true;
    readonly containsCurrentState: true;
    readonly containsInput: false;
    readonly containsAuthenticatedIdentity: false;
    readonly containsExtensions: false;
    readonly grantsAuthority: false;
    readonly runtimeAuthorizationRequired: true;
  };
  readonly freshness: {
    readonly mode: "pointInTime";
    readonly retrievedAt: string;
    readonly maxAgeSeconds: 0;
    readonly revalidate: "beforeReuse";
  };
  readonly data: Data;
}

export type ${manifest.model.name}TaskPacketObservation =
${taskObservationResults || "  never"};

export interface ${manifest.model.name}AgentTaskPacket {
  readonly $schema: "https://modellang.dev/schemas/agent-task-packet.schema.json";
  readonly packetVersion: 1;
  readonly catalogVersion: 7;
  readonly resourceVersion: 1;
  readonly model: { readonly id: string; readonly name: string; readonly version: string; readonly sourceHash: string };
  readonly packetId: string;
  readonly kind: "boundedTaskContext";
  readonly authority: "none";
  readonly view: {
    readonly audience: "agent";
    readonly subjectSpecific: true;
    readonly authorizationFiltered: true;
    readonly inputSpecific: true;
    readonly containsCurrentState: true;
    readonly containsOperationInput: false;
    readonly containsObservationInput: false;
    readonly containsRequestBindings: true;
    readonly containsAuthenticatedIdentity: false;
    readonly containsExpressions: false;
    readonly containsExtensions: false;
    readonly grantsAuthority: false;
    readonly runtimeAuthorizationRequired: true;
  };
  readonly freshness: {
    readonly mode: "pointInTime";
    readonly assembledAt: string;
    readonly maxAgeSeconds: 0;
    readonly revalidate: "beforeReuse";
  };
  readonly snapshot: { readonly atomic: false; readonly observations: "independentReads" };
  readonly closure: {
    readonly status: "partial";
    readonly dimensions: {
      readonly identity: "bounded";
      readonly type: "complete";
      readonly applicability: "evaluated";
      readonly effect: "bounded";
      readonly lifecycle: "bounded";
      readonly observation: "callerSelected";
      readonly version: "complete";
      readonly recovery: "absent";
    };
    readonly gaps: readonly [
      "declarationIdentityClosureNotPublished",
      "taskGoalNotModeled",
      "observationRelevanceNotProven",
      "stateWriteEffectsNotPublished",
      "externalEffectsNotPublished",
      "reversibilityNotPublished",
      "recoveryNotPublished",
    ];
  };
  readonly actions: readonly {
    readonly operationId: string;
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly outputSchema: Readonly<Record<string, unknown>>;
    readonly errors: readonly string[];
    readonly reliability: {
      readonly idempotency: "required" | "unsupported";
      readonly scope: "authenticatedPrincipal";
      readonly replay: "storedResult" | "none";
      readonly fingerprint: "canonicalSha256" | "none";
    };
    readonly emittedEventIds: readonly string[];
    readonly workflowTransitions: readonly {
      readonly workflowId: string;
      readonly transitionId: string;
      readonly fromMemberId: string;
      readonly toMemberId: string;
      readonly targetParameterId: string;
    }[];
    readonly applicability: ApplicabilityDecision;
  }[];
  readonly observations: readonly ${manifest.model.name}TaskPacketObservation[];
}

${extensionTypes}

export class ${manifest.model.name}HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ${manifest.model.name}HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async call<Result>(path: string, input: unknown, options: ExecutionOptions = {}): Promise<Result> {
    const token = await this.options.accessToken();
    if (!token) throw new AuthenticationError("HTTP authentication is required", "ML_AUTHENTICATION");
    const response = await this.fetchImpl(\`\${this.baseUrl}\${path}\`, {
      method: "POST",
      headers: {
        ...this.options.headers,
        authorization: \`Bearer \${token}\`,
        ...(options.expectedRevision ? { "if-match": \`"\${options.expectedRevision}"\` } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...(options.correlationId ? { "x-correlation-id": options.correlationId } : {}),
        ...(options.causationId ? { "x-causation-id": options.causationId } : {}),
        "content-type": "application/json",
        accept: "application/json, application/problem+json",
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => undefined);
      throw mapHttpProblem(problem, response.status);
    }
    return await response.json() as Result;
  }

  async subjectCapabilities(
    candidates: readonly ${manifest.model.name}SubjectCapabilityCandidate[],
  ): Promise<${manifest.model.name}SubjectCapabilityView> {
    return this.call(${JSON.stringify(SUBJECT_CAPABILITY_ROUTE)}, { candidates });
  }

  async taskPacket(request: ${manifest.model.name}TaskPacketRequest): Promise<${manifest.model.name}AgentTaskPacket> {
    return this.call(${JSON.stringify(TASK_PACKET_ROUTE)}, request);
  }

  async publicDecisionTrace(action: ${manifest.model.name}SubjectCapabilityCandidate): Promise<${manifest.model.name}PublicDecisionTrace> {
    return this.call(${JSON.stringify(PUBLIC_DECISION_TRACE_ROUTE)}, { action });
  }

  async issueDelegatedCapability(request: ${manifest.model.name}DelegationRequest): Promise<${manifest.model.name}DelegatedCapability> {
    return this.call(${JSON.stringify(DELEGATION_ROUTE)}, request);
  }

  async revokeDelegatedCapability(grantId: string): Promise<${manifest.model.name}DelegationRevocation> {
    return this.call(\`${DELEGATION_REVOKE_ROUTE_PREFIX}\${encodeURIComponent(grantId)}/revoke\`, {});
  }

${methods}

${assessments}

${resources}

${extensionMethods}
}
`;
}

function generateHttpServer(
  manifest: OperationManifest,
  capabilities: CapabilityManifest,
  taskActionContracts: readonly TaskPacketActionContract[],
  publicDecisionTraceActionContracts: readonly PublicDecisionTraceActionContract[],
  extensionTools: readonly AgentExtensionTool[],
): string {
  const definitions = manifest.operations.map((operation) => ({
    id: operation.id,
    route: operationRoute(operation),
    endpoint: "execution",
    input: operation.input,
    output: operation.output,
    sorting: operation.kind === "query" ? operation.sorting : undefined,
    action: operation.kind === "action",
    idempotency: operation.kind === "action" ? operation.reliability.idempotency : "unsupported",
  })).concat(manifest.operations.filter((operation) => operation.kind === "action").map((operation) => ({
    id: operation.id,
    route: applicabilityRoute(operation),
    endpoint: "applicability",
    input: operation.input,
    output: operation.output,
    sorting: undefined,
    action: true,
    idempotency: "unsupported",
  }))).concat(manifest.operations.filter((operation) => operation.kind === "query").map((operation) => ({
    id: operation.id,
    route: agentResourceRoute(operation),
    endpoint: "resource",
    input: operation.input,
    output: operation.output,
    sorting: operation.sorting,
    action: false,
    idempotency: "unsupported",
  })));
  const enumValues = Object.fromEntries(manifest.enums.map((enumeration) => [
    enumeration.id,
    enumeration.members.map((member) => member.value),
  ]));
  const entityDefinitions = Object.fromEntries(manifest.entities.map((entity) => [
    entity.id,
    entity.fields.map((field) => ({
      name: field.name,
      type: field.type,
      nullable: field.nullable,
    })),
  ]));
  const projectionDefinitions = Object.fromEntries(manifest.projections.map((projection) => [
    projection.id,
    projection.fields.map((field) => ({
      name: field.name,
      type: field.type,
      nullable: field.nullable,
      ...(field.nestedProjectionId ? { nestedProjectionId: field.nestedProjectionId } : {}),
    })),
  ]));
  const operationIds = manifest.operations.map((operation) => JSON.stringify(operation.id)).join(" | ");
  const actionIds = manifest.operations.filter((operation) => operation.kind === "action").map((operation) => JSON.stringify(operation.id)).join(" | ") || "never";
  const extensionIds = extensionTools.map((tool) => JSON.stringify(tool.id)).join(" | ") || "never";
  const extensionResultImports = extensionTools.map((tool) => `${extensionClientTypeName(manifest.model.name, tool)}Result`);
  const extensionResultUnion = extensionResultImports.join(" | ") || "never";
  const httpClientImports = [
    `${manifest.model.name}AgentTaskPacket`,
    `${manifest.model.name}DelegatedCapability`,
    `${manifest.model.name}DelegationRequest`,
    `${manifest.model.name}DelegationRevocation`,
    `${manifest.model.name}PublicDecisionTrace`,
    `${manifest.model.name}SubjectCapabilityCandidate`,
    `${manifest.model.name}SubjectCapabilityView`,
    `${manifest.model.name}TaskPacketRequest`,
    ...extensionResultImports,
  ];
  const inputImports = manifest.operations.map(operationInputName);
  const dispatch = manifest.operations.map((operation) => operation.kind === "action"
    ? `      case ${JSON.stringify(operation.id)}: return client.${operation.name}(input as unknown as ${operationInputName(operation)}, options);`
    : `      case ${JSON.stringify(operation.id)}: return client.${operation.name}(input as unknown as ${operationInputName(operation)});`).join("\n");
  const assessDispatch = manifest.operations.filter((operation) => operation.kind === "action").map((operation) =>
    `      case ${JSON.stringify(operation.id)}: return client.assess${operation.name[0]!.toUpperCase()}${operation.name.slice(1)}(input as unknown as ${operationInputName(operation)}, options);`,
  ).join("\n");
  const safeExplanations = Object.fromEntries(capabilities.actions.map((action) => [action.operationId, {
    authorization: action.explanation.authorizationRuleId,
    requirements: action.explanation.preconditionRuleIds,
    revision: action.explanation.revisionRuleId,
  }]));
  return `// Generated by ModelLang. Do not edit.
import type { ${[...inputImports, "ApplicabilityDecision", "ApplicabilityOptions", "ExecutionOptions"].join(", ")} } from "./types.js";
import type {
${httpClientImports.map((name) => `  ${name},`).join("\n")}
} from "./http-client.js";
import { ${manifest.model.name}Client } from "./client.js";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  IdempotencyConflictError,
  IdentityBindingError,
  InvariantError,
  ModelOperationError,
  NotFoundError,
  PreconditionError,
  StaleError,
  TransitionError,
  ValidationError,
} from "./errors.js";

export type ${manifest.model.name}OperationId = ${operationIds};
export type ${manifest.model.name}ActionOperationId = ${actionIds};
export type ${manifest.model.name}ExtensionOperationId = ${extensionIds};

interface RuntimeValueType {
  kind: "scalar" | "entity" | "enum" | "enumSet" | "money";
  name?: string;
  entityId?: string;
  enumId?: string;
  currency?: string;
  precision?: number;
  scale?: number;
}

interface OperationDefinition {
  id: ${manifest.model.name}OperationId;
  route: string;
  endpoint: "execution" | "applicability" | "resource";
  input: readonly { name: string; type: RuntimeValueType; optional?: true }[];
  sorting?: { input: "sort"; defaultProfile: "default"; profiles: readonly { name: string }[] };
  output:
    | { entityId: string; cardinality: "one" }
    | { projectionId: string; cardinality: "many"; maxItems: number }
    | {
        projectionId: string;
        cardinality: "page";
        maxItems: number;
        pagination: { kind: "cursor"; cursorVersion: 1; queryRevision: string; cursorInput: "cursor" };
      };
  action: boolean;
  idempotency: "required" | "unsupported";
}

interface ExtensionDefinition {
  id: ${manifest.model.name}ExtensionOperationId;
  name: string;
  contractRevision: string;
  route: string;
  input: readonly { name: string; type: RuntimeValueType; optional: boolean }[];
  result: { type: RuntimeValueType; optional: boolean };
  authorization: { declaredContext: "authenticatedCaller" | "serviceIdentity" | "none" };
  reliability: { deterministic: boolean; idempotent: boolean; retry: "none" | "hostManaged" };
}

const operationDefinitions = ${JSON.stringify(definitions, null, 2)} as unknown as readonly OperationDefinition[];
const enumValues = ${JSON.stringify(enumValues, null, 2)} as Readonly<Record<string, readonly string[]>>;
const entityDefinitions = ${JSON.stringify(entityDefinitions, null, 2)} as Readonly<Record<
  string,
  readonly { name: string; type: RuntimeValueType; nullable: boolean }[]
>>;
const projectionDefinitions = ${JSON.stringify(projectionDefinitions, null, 2)} as Readonly<Record<
  string,
  readonly { name: string; type: RuntimeValueType; nullable: boolean; nestedProjectionId?: string }[]
>>;
const safeExplanations = ${JSON.stringify(safeExplanations, null, 2)} as Readonly<Record<
  ${manifest.model.name}ActionOperationId,
  { authorization: string; requirements: readonly string[]; revision: string }
>>;
const taskActionContracts = ${JSON.stringify(taskActionContracts, null, 2)} as Readonly<Record<string, unknown>[]>;
const publicDecisionTraceActionContracts = ${JSON.stringify(publicDecisionTraceActionContracts, null, 2)} as const;
const extensionDefinitions = ${JSON.stringify(extensionTools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    contractRevision: tool.contractRevision,
    route: tool.execution.path,
    input: tool.input,
    result: tool.result,
    authorization: { declaredContext: tool.authorization.declaredContext },
    reliability: tool.reliability,
  })), null, 2)} as unknown as readonly ExtensionDefinition[];

export interface ${manifest.model.name}OperationExecutor {
  execute(operationId: ${manifest.model.name}OperationId, input: Readonly<Record<string, unknown>>, options?: ExecutionOptions): Promise<unknown>;
  assess(operationId: ${manifest.model.name}ActionOperationId, input: Readonly<Record<string, unknown>>, options?: ApplicabilityOptions): Promise<ApplicabilityDecision>;
}

export interface ${manifest.model.name}ExtensionInvocationOptions {
  readonly invocationId: string;
  readonly contractRevision: string;
  readonly declaredAuthorizationContext: "authenticatedCaller" | "serviceIdentity" | "none";
  readonly retry: "none" | "hostManaged";
}

/**
 * Host adapter bound to the identity authenticated for this request. supports is
 * an explicit registration assertion, not compiler verification. authorize must
 * enforce caller and service policy before invoke crosses the external boundary.
 */
export interface ${manifest.model.name}ExtensionRuntime {
  supports(extensionId: ${manifest.model.name}ExtensionOperationId, contractRevision: string): boolean | Promise<boolean>;
  authorize(extensionId: ${manifest.model.name}ExtensionOperationId, input: Readonly<Record<string, unknown>>): boolean | Promise<boolean>;
  invoke(
    extensionId: ${manifest.model.name}ExtensionOperationId,
    input: Readonly<Record<string, unknown>>,
    options: ${manifest.model.name}ExtensionInvocationOptions,
  ): Promise<unknown>;
}

export type ${manifest.model.name}DelegatedCapabilityClaim = Omit<${manifest.model.name}DelegatedCapability, "credential" | "view">;

export interface ${manifest.model.name}DelegationIssueRequest {
  readonly action: { readonly operationId: ${manifest.model.name}ActionOperationId; readonly input: Readonly<Record<string, unknown>> };
  readonly inputHash: string;
  readonly delegate: { readonly issuer: string; readonly subject: string };
  readonly audience: string;
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly revision: string;
}

/**
 * Host credential authority bound to the principal authenticated for this request.
 * issue and revoke must enforce grantor ownership. inspect must expose claims only
 * to the named authenticated delegate. invoke must atomically recheck the grant,
 * consume its single use, and execute through the stored grantor-bound executor.
 */
export interface ${manifest.model.name}DelegationRuntime {
  issue(request: ${manifest.model.name}DelegationIssueRequest): Promise<{ grantId: string; credential: string }>;
  revoke(grantId: string): Promise<${manifest.model.name}DelegationRevocation>;
  inspect(credential: string): Promise<${manifest.model.name}DelegatedCapabilityClaim | null>;
  invoke(
    credential: string,
    claim: ${manifest.model.name}DelegatedCapabilityClaim,
    operationId: ${manifest.model.name}ActionOperationId,
    input: Readonly<Record<string, unknown>>,
    options: ExecutionOptions,
  ): Promise<unknown>;
}

export interface ${manifest.model.name}AuthenticatedContext {
  readonly executor: ${manifest.model.name}OperationExecutor;
  readonly delegation?: ${manifest.model.name}DelegationRuntime;
  readonly extensions?: ${manifest.model.name}ExtensionRuntime;
}

export type ${manifest.model.name}AuthenticationResult = ${manifest.model.name}OperationExecutor | ${manifest.model.name}AuthenticatedContext;

export type ${manifest.model.name}Authenticator = (
  bearerToken: string,
) => ${manifest.model.name}AuthenticationResult | null | Promise<${manifest.model.name}AuthenticationResult | null>;

export interface ${manifest.model.name}HttpHandlerOptions {
  basePath?: string;
  maxBodyBytes?: number;
  now?: () => Date;
  delegationAudience?: string;
}

export function create${manifest.model.name}DatabaseExecutor(
  client: ${manifest.model.name}Client,
): ${manifest.model.name}OperationExecutor {
  return {
    async execute(operationId, input, options = {}) {
      switch (operationId) {
${dispatch}
      }
    },
    async assess(operationId, input, options = {}) {
      switch (operationId) {
${assessDispatch}
      }
    },
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && /^-?(0|[1-9][0-9]*)(?:\\.[0-9]+)?$/.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validValue(value: unknown, type: RuntimeValueType): boolean {
  if (type.kind === "entity") return isUuid(value);
  if (type.kind === "enum") return typeof value === "string" && (enumValues[type.enumId ?? ""]?.includes(value) ?? false);
  if (type.kind === "enumSet") {
    return Array.isArray(value)
      && value.every((member) => typeof member === "string" && (enumValues[type.enumId ?? ""]?.includes(member) ?? false))
      && new Set(value).size === value.length;
  }
  if (type.kind === "money") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const money = value as Record<string, unknown>;
    if (Object.keys(money).some((key) => key !== "currency" && key !== "amount")
      || money.currency !== type.currency || !isDecimal(money.amount)) return false;
    const match = /^-?(0|[1-9][0-9]*)(?:\\.([0-9]+))?$/.exec(money.amount);
    const integralDigits = match?.[1] === "0" ? 1 : (match?.[1]?.length ?? 0);
    const fractionalDigits = match?.[2]?.length ?? 0;
    return integralDigits <= (type.precision ?? 0) - (type.scale ?? 0)
      && fractionalDigits <= (type.scale ?? 0);
  }
  if (type.name === "String") return typeof value === "string";
  if (type.name === "Int") return typeof value === "number" && Number.isSafeInteger(value);
  if (type.name === "Decimal") return isDecimal(value);
  if (type.name === "Boolean") return typeof value === "boolean";
  if (type.name === "UUID") return isUuid(value);
  if (type.name === "DateTime") return isDateTime(value);
  return false;
}

function validateInput(
  definition: OperationDefinition,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Operation input must be a JSON object", "ML_VALIDATION", "transport:request_body");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(definition.input.map((parameter) => parameter.name));
  if (definition.sorting) allowed.add(definition.sorting.input);
  if (definition.output.cardinality === "page") allowed.add(definition.output.pagination.cursorInput);
  const unknown = Object.keys(input).find((name) => !allowed.has(name));
  if (unknown) {
    throw new ValidationError(\`Unknown operation input property '\${unknown}'\`, "ML_VALIDATION", "transport:request_body");
  }
  for (const parameter of definition.input) {
    const present = Object.hasOwn(input, parameter.name);
    if ((!present && parameter.optional) || (present && input[parameter.name] === null && parameter.optional)) continue;
    if (!present || !validValue(input[parameter.name], parameter.type)) {
      throw new ValidationError(
        \`Invalid operation input property '\${parameter.name}'\`,
        "ML_VALIDATION",
        \`transport:parameter:\${parameter.name}\`,
      );
    }
  }
  if (definition.sorting && Object.hasOwn(input, definition.sorting.input)) {
    const sort = input[definition.sorting.input];
    if (typeof sort !== "string" || !definition.sorting.profiles.some((profile) => profile.name === sort)) {
      throw new ValidationError("Invalid authored sort profile", "ML_VALIDATION", \`sort-profile:\${definition.id}\`);
    }
  }
  if (definition.output.cardinality === "page" && Object.hasOwn(input, definition.output.pagination.cursorInput)) {
    const cursor = input[definition.output.pagination.cursorInput];
    if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new ValidationError("Invalid continuation cursor", "ML_VALIDATION", \`cursor:\${definition.id}\`);
    }
  }
  return input;
}

function validateExtensionInput(
  definition: ExtensionDefinition,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Extension input must be a JSON object", "ML_VALIDATION", "extension:input");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(definition.input.map((parameter) => parameter.name));
  if (Object.keys(input).some((name) => !allowed.has(name))) {
    throw new ValidationError("Extension input contains an unknown property", "ML_VALIDATION", "extension:input");
  }
  for (const parameter of definition.input) {
    const present = Object.hasOwn(input, parameter.name);
    if (parameter.optional && (!present || input[parameter.name] === null)) continue;
    if (!present || !validValue(input[parameter.name], parameter.type)) {
      throw new ValidationError(
        \`Invalid extension input property '\${parameter.name}'\`,
        "ML_VALIDATION",
        \`extension:parameter:\${parameter.name}\`,
      );
    }
  }
  return input;
}

function validateExtensionResult(definition: ExtensionDefinition, value: unknown): void {
  if (value === null && definition.result.optional) return;
  if (!validValue(value, definition.result.type)) {
    throw new Error(\`Host extension returned an invalid result for '\${definition.id}'\`);
  }
}

function validEntity(value: unknown, entityId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = entityDefinitions[entityId];
  if (!fields) return false;
  const entity = value as Record<string, unknown>;
  const allowed = new Set(fields.map((field) => field.name));
  if (Object.keys(entity).some((name) => !allowed.has(name))) return false;
  return fields.every((field) => Object.hasOwn(entity, field.name)
    && (entity[field.name] === null ? field.nullable : validValue(entity[field.name], field.type)));
}

function validProjection(value: unknown, projectionId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = projectionDefinitions[projectionId];
  if (!fields) return false;
  const projection = value as Record<string, unknown>;
  const allowed = new Set(fields.map((field) => field.name));
  if (Object.keys(projection).some((name) => !allowed.has(name))) return false;
  return fields.every((field) => Object.hasOwn(projection, field.name)
    && (projection[field.name] === null
      ? field.nullable
      : field.nestedProjectionId
        ? validProjection(projection[field.name], field.nestedProjectionId)
        : validValue(projection[field.name], field.type)));
}

function validateOutput(definition: OperationDefinition, value: unknown): void {
  let valid: boolean;
  if (definition.output.cardinality === "one") {
    valid = validEntity(value, definition.output.entityId);
  } else if (definition.output.cardinality === "many") {
    const output = definition.output;
    valid = Array.isArray(value)
      && value.length <= output.maxItems
      && value.every((projection) => validProjection(projection, output.projectionId));
  } else {
    const output = definition.output;
    const page = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    valid = !!page
      && Object.keys(page).length === 2
      && Object.hasOwn(page, "items")
      && Object.hasOwn(page, "nextCursor")
      && Array.isArray(page.items)
      && page.items.length <= output.maxItems
      && page.items.every((projection) => validProjection(projection, output.projectionId))
      && (page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length >= 1 && page.nextCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(page.nextCursor)));
  }
  if (!valid) throw new Error(\`Operation executor returned an invalid result for '\${definition.id}'\`);
}

function expectedRevision(request: Request): string | undefined {
  const header = request.headers.get("if-match");
  if (header === null) return undefined;
  const match = /^"(rev:1:[0-9a-f]{32})"$/.exec(header);
  if (!match) throw new ValidationError("If-Match must contain one quoted ModelLang revision", "ML_VALIDATION", "transport:expected_revision");
  return match[1];
}

const commandMetadataPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
function executionOptions(
  request: Request,
  definition: OperationDefinition,
  revision: string | undefined,
): ExecutionOptions {
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const suppliedCorrelationId = request.headers.get("x-correlation-id") ?? undefined;
  const causationId = request.headers.get("x-causation-id") ?? undefined;
  if (definition.endpoint !== "execution" || !definition.action) {
    if (idempotencyKey || suppliedCorrelationId || causationId) {
      throw new ValidationError("Command metadata is not accepted by this endpoint", "ML_IDEMPOTENCY_UNSUPPORTED", \`idempotency:\${definition.id}\`);
    }
    return { expectedRevision: revision };
  }
  if (definition.idempotency === "required" && !idempotencyKey) {
    throw new ValidationError("An Idempotency-Key header is required", "ML_IDEMPOTENCY_REQUIRED", \`idempotency:\${definition.id}\`);
  }
  if (definition.idempotency === "unsupported" && idempotencyKey) {
    throw new ValidationError("This action does not support Idempotency-Key", "ML_IDEMPOTENCY_UNSUPPORTED", \`idempotency:\${definition.id}\`);
  }
  const correlationId = suppliedCorrelationId
    ?? (definition.idempotency === "required" ? idempotencyKey : globalThis.crypto.randomUUID());
  if ((idempotencyKey && !commandMetadataPattern.test(idempotencyKey))
    || (correlationId && !commandMetadataPattern.test(correlationId))
    || (causationId && !commandMetadataPattern.test(causationId))) {
    throw new ValidationError("Command metadata is invalid", "ML_VALIDATION", \`idempotency:\${definition.id}\`);
  }
  return { expectedRevision: revision, idempotencyKey, correlationId, causationId };
}

function validateDecision(definition: OperationDefinition, value: unknown): ApplicabilityDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(\`Applicability executor returned an invalid decision for '\${definition.id}'\`);
  }
  const decision = value as Record<string, unknown>;
  const allowed = new Set(["operationId", "status", "applicable", "authority", "revision", "explanation"]);
  const status = decision.status;
  const explanation = decision.explanation as Record<string, unknown> | undefined;
  const safe = safeExplanations[definition.id as ${manifest.model.name}ActionOperationId];
  const ruleId = explanation?.ruleId;
  const kind = explanation?.kind;
  const expectedRule = kind === "authorization" ? safe?.authorization
    : kind === "requirement" && typeof ruleId === "string" && safe?.requirements.includes(ruleId) ? ruleId
      : kind === "revision" ? safe?.revision : undefined;
  const valid = Object.keys(decision).every((key) => allowed.has(key))
    && decision.operationId === definition.id
    && ["applicable", "denied", "notApplicable", "stale"].includes(status as string)
    && decision.applicable === (status === "applicable")
    && decision.authority === "none"
    && (status === "denied" ? decision.revision === undefined : typeof decision.revision === "string" && /^rev:1:[0-9a-f]{32}$/.test(decision.revision))
    && (status === "applicable" ? explanation === undefined : !!explanation
      && Object.keys(explanation).length === 2
      && expectedRule !== undefined && ruleId === expectedRule
      && ((status === "denied" && kind === "authorization")
        || (status === "notApplicable" && kind === "requirement")
        || (status === "stale" && kind === "revision")));
  if (!valid) throw new Error(\`Applicability executor returned an invalid decision for '\${definition.id}'\`);
  return value as ApplicabilityDecision;
}

function validateSubjectCandidates(value: unknown): readonly ${manifest.model.name}SubjectCapabilityCandidate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Subject capability input must be a JSON object", "ML_VALIDATION", "agent:subject-capabilities");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).length !== 1 || !Object.hasOwn(request, "candidates") || !Array.isArray(request.candidates)
    || request.candidates.length < ${manifest.operations.some((operation) => operation.kind === "action") ? 1 : 0}
    || request.candidates.length > ${manifest.operations.some((operation) => operation.kind === "action") ? SUBJECT_CAPABILITY_MAX_CANDIDATES : 0}) {
    throw new ValidationError("Subject capability candidates are invalid for the declared action set", "ML_VALIDATION", "agent:subject-capabilities");
  }
  const seen = new Set<string>();
  return request.candidates.map((rawCandidate) => {
    if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
      throw new ValidationError("Subject capability candidate must be an object", "ML_VALIDATION", "agent:subject-capability-candidate");
    }
    const candidate = rawCandidate as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== "operationId" && key !== "input" && key !== "expectedRevision")
      || typeof candidate.operationId !== "string" || !Object.hasOwn(candidate, "input")) {
      throw new ValidationError("Subject capability candidate is not closed", "ML_VALIDATION", "agent:subject-capability-candidate");
    }
    const definition = operationDefinitions.find((item) =>
      item.endpoint === "execution" && item.action && item.id === candidate.operationId);
    if (!definition) {
      throw new ValidationError("Subject capability candidate must name a declared action", "ML_VALIDATION", "agent:subject-capability-operation");
    }
    if (seen.has(definition.id)) {
      throw new ValidationError("Subject capability actions must be unique", "ML_VALIDATION", "agent:subject-capability-operation");
    }
    seen.add(definition.id);
    if (candidate.expectedRevision !== undefined
      && (typeof candidate.expectedRevision !== "string" || !/^rev:1:[0-9a-f]{32}$/.test(candidate.expectedRevision))) {
      throw new ValidationError("Subject capability expected revision is invalid", "ML_VALIDATION", "agent:subject-capability-revision");
    }
    return {
      operationId: definition.id as ${manifest.model.name}ActionOperationId,
      input: validateInput(definition, candidate.input),
      ...(candidate.expectedRevision === undefined ? {} : { expectedRevision: candidate.expectedRevision }),
    } as unknown as ${manifest.model.name}SubjectCapabilityCandidate;
  });
}

function validatePublicDecisionTraceRequest(value: unknown): ${manifest.model.name}SubjectCapabilityCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value as object).length !== 1 || !Object.hasOwn(value, "action")) {
    throw new ValidationError("Public decision trace input must contain one exact action", "ML_VALIDATION", "agent:public-decision-trace");
  }
  return validateSubjectCandidates({ candidates: [(value as { action: unknown }).action] })[0]!;
}

function validateTaskPacketRequest(value: unknown): ${manifest.model.name}TaskPacketRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Task packet input must be a JSON object", "ML_VALIDATION", "agent:task-packet");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => key !== "actions" && key !== "observations")
    || !Array.isArray(request.actions) || !Array.isArray(request.observations)
    || request.actions.length < ${manifest.operations.some((operation) => operation.kind === "action") ? 1 : 0}
    || request.actions.length > ${manifest.operations.some((operation) => operation.kind === "action") ? TASK_PACKET_MAX_ACTIONS : 0}
    || request.observations.length < ${manifest.operations.some((operation) => operation.kind === "action") || !manifest.operations.some((operation) => operation.kind === "query") ? 0 : 1}
    || request.observations.length > ${manifest.operations.some((operation) => operation.kind === "query") ? TASK_PACKET_MAX_OBSERVATIONS : 0}) {
    throw new ValidationError("Task packet actions or observations are outside declared bounds", "ML_VALIDATION", "agent:task-packet");
  }
  const seenActions = new Set<string>();
  const actions = request.actions.map((rawCandidate) => {
    if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
      throw new ValidationError("Task packet action must be an object", "ML_VALIDATION", "agent:task-packet-action");
    }
    const candidate = rawCandidate as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== "operationId" && key !== "input" && key !== "expectedRevision")
      || typeof candidate.operationId !== "string" || !Object.hasOwn(candidate, "input")) {
      throw new ValidationError("Task packet action is not closed", "ML_VALIDATION", "agent:task-packet-action");
    }
    const definition = operationDefinitions.find((item) =>
      item.endpoint === "execution" && item.action && item.id === candidate.operationId);
    if (!definition || seenActions.has(definition.id)) {
      throw new ValidationError("Task packet actions must name distinct declared actions", "ML_VALIDATION", "agent:task-packet-action");
    }
    seenActions.add(definition.id);
    if (candidate.expectedRevision !== undefined
      && (typeof candidate.expectedRevision !== "string" || !/^rev:1:[0-9a-f]{32}$/.test(candidate.expectedRevision))) {
      throw new ValidationError("Task packet expected revision is invalid", "ML_VALIDATION", "agent:task-packet-revision");
    }
    return {
      operationId: definition.id,
      input: validateInput(definition, candidate.input),
      ...(candidate.expectedRevision === undefined ? {} : { expectedRevision: candidate.expectedRevision }),
    };
  });
  const seenBindings = new Set<string>();
  const observations = request.observations.map((rawObservation) => {
    if (!rawObservation || typeof rawObservation !== "object" || Array.isArray(rawObservation)) {
      throw new ValidationError("Task packet observation must be an object", "ML_VALIDATION", "agent:task-packet-observation");
    }
    const observation = rawObservation as Record<string, unknown>;
    if (Object.keys(observation).some((key) => key !== "binding" && key !== "operationId" && key !== "input")
      || typeof observation.binding !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(observation.binding)
      || typeof observation.operationId !== "string" || !Object.hasOwn(observation, "input")) {
      throw new ValidationError("Task packet observation is not closed", "ML_VALIDATION", "agent:task-packet-observation");
    }
    if (seenBindings.has(observation.binding)) {
      throw new ValidationError("Task packet observation bindings must be unique", "ML_VALIDATION", "agent:task-packet-binding");
    }
    seenBindings.add(observation.binding);
    const definition = operationDefinitions.find((item) =>
      item.endpoint === "execution" && !item.action && item.id === observation.operationId);
    if (!definition) {
      throw new ValidationError("Task packet observation must name a declared query", "ML_VALIDATION", "agent:task-packet-observation");
    }
    return {
      binding: observation.binding,
      operationId: definition.id,
      input: validateInput(definition, observation.input),
    };
  });
  return { actions, observations } as unknown as ${manifest.model.name}TaskPacketRequest;
}

function authenticatedContext(value: ${manifest.model.name}AuthenticationResult): ${manifest.model.name}AuthenticatedContext {
  return "executor" in value ? value : { executor: value };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return \`[\${value.map(canonicalJson).join(",")}]\`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return \`{\${Object.keys(object).sort().map((key) => \`\${JSON.stringify(key)}:\${canonicalJson(object[key])}\`).join(",")}}\`;
  }
  throw new ValidationError("Delegated capability input must be JSON", "ML_VALIDATION", "agent:delegation-input");
}

async function canonicalSha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return \`sha256:\${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}\`;
}

function absoluteUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function validateDelegationRequest(value: unknown): ${manifest.model.name}DelegationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Delegation input must be a JSON object", "ML_VALIDATION", "agent:delegation");
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !["action", "delegate", "audience", "expiresInSeconds"].includes(key))
    || !request.action || typeof request.action !== "object" || Array.isArray(request.action)
    || !request.delegate || typeof request.delegate !== "object" || Array.isArray(request.delegate)
    || !absoluteUri(request.audience)
    || !Number.isInteger(request.expiresInSeconds)
    || (request.expiresInSeconds as number) < 1
    || (request.expiresInSeconds as number) > ${DELEGATION_MAX_TTL_SECONDS}) {
    throw new ValidationError("Delegation input is outside the exact bounded contract", "ML_VALIDATION", "agent:delegation");
  }
  const action = request.action as Record<string, unknown>;
  const delegate = request.delegate as Record<string, unknown>;
  if (Object.keys(action).some((key) => key !== "operationId" && key !== "input")
    || typeof action.operationId !== "string" || !Object.hasOwn(action, "input")
    || Object.keys(delegate).some((key) => key !== "issuer" && key !== "subject")
    || !absoluteUri(delegate.issuer)
    || typeof delegate.subject !== "string" || delegate.subject.length < 1 || delegate.subject.length > 256) {
    throw new ValidationError("Delegation action or delegate is invalid", "ML_VALIDATION", "agent:delegation");
  }
  const definition = operationDefinitions.find((item) =>
    item.endpoint === "execution" && item.action && item.id === action.operationId);
  if (!definition) {
    throw new ValidationError("Delegation must name one declared action", "ML_VALIDATION", "agent:delegation-action");
  }
  return {
    action: { operationId: definition.id as ${manifest.model.name}ActionOperationId, input: validateInput(definition, action.input) },
    delegate: { issuer: delegate.issuer, subject: delegate.subject },
    audience: request.audience,
    expiresInSeconds: request.expiresInSeconds,
  } as unknown as ${manifest.model.name}DelegationRequest;
}

function validGrantId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateDelegatedClaim(
  value: unknown,
  expectedAudience: string,
  nowEpoch: number,
): ${manifest.model.name}DelegatedCapabilityClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorizationError("Delegated capability is invalid", "ML_DELEGATION_INVALID", "delegation:claim");
  }
  const claim = value as Record<string, unknown>;
  const allowed = new Set([
    "$schema", "delegatedCapabilityVersion", "catalogVersion", "model", "grantId", "operationId",
    "inputHash", "authority", "issuedAt", "notBefore", "expiresAt", "revision", "audience", "constraints",
  ]);
  const model = claim.model as Record<string, unknown> | undefined;
  const constraints = claim.constraints as Record<string, unknown> | undefined;
  const valid = Object.keys(claim).every((key) => allowed.has(key))
    && claim.$schema === "https://modellang.dev/schemas/delegated-capability.schema.json"
    && claim.delegatedCapabilityVersion === 1 && claim.catalogVersion === 7
    && model?.id === ${JSON.stringify(manifest.model.id)}
    && model?.name === ${JSON.stringify(manifest.model.name)}
    && model?.version === ${JSON.stringify(manifest.model.version)}
    && model?.sourceHash === ${JSON.stringify(manifest.model.sourceHash)}
    && Object.keys(model).length === 4
    && validGrantId(claim.grantId)
    && operationDefinitions.some((item) => item.endpoint === "execution" && item.action && item.id === claim.operationId)
    && typeof claim.inputHash === "string" && /^sha256:[0-9a-f]{64}$/.test(claim.inputHash)
    && claim.authority === "delegated"
    && Number.isInteger(claim.issuedAt) && Number.isInteger(claim.notBefore) && Number.isInteger(claim.expiresAt)
    && (claim.issuedAt as number) <= (claim.notBefore as number)
    && (claim.notBefore as number) <= nowEpoch && nowEpoch < (claim.expiresAt as number)
    && (claim.expiresAt as number) - (claim.issuedAt as number) <= ${DELEGATION_MAX_TTL_SECONDS}
    && typeof claim.revision === "string" && /^rev:1:[0-9a-f]{32}$/.test(claim.revision)
    && claim.audience === expectedAudience
    && constraints?.operation === "exact"
    && constraints?.input === "canonicalSha256"
    && constraints?.revision === "required"
    && constraints?.uses === 1
    && constraints?.transferable === false
    && constraints?.redelegation === false
    && Object.keys(constraints).length === 6;
  if (!valid) {
    throw new AuthorizationError("Delegated capability is invalid, expired, or outside its audience", "ML_DELEGATION_INVALID", "delegation:claim");
  }
  return value as ${manifest.model.name}DelegatedCapabilityClaim;
}

export async function invoke${manifest.model.name}DelegatedCapability(
  delegation: ${manifest.model.name}DelegationRuntime,
  credential: string,
  operationId: ${manifest.model.name}ActionOperationId,
  value: unknown,
  audience: string,
  now: () => Date = () => new Date(),
): Promise<unknown> {
  if (credential.length < 32 || credential.length > 4096) {
    throw new AuthorizationError("Delegated capability is unavailable", "ML_DELEGATION_INVALID", "delegation:credential");
  }
  const definition = operationDefinitions.find((item) =>
    item.endpoint === "execution" && item.action && item.id === operationId)!;
  const input = validateInput(definition, value);
  const claim = validateDelegatedClaim(
    await delegation.inspect(credential),
    audience,
    Math.floor(now().getTime() / 1000),
  );
  if (claim.operationId !== operationId || claim.inputHash !== await canonicalSha256(input)) {
    throw new AuthorizationError("Delegated capability does not match this exact action input", "ML_DELEGATION_SCOPE", "delegation:scope");
  }
  const command: ExecutionOptions = {
    expectedRevision: claim.revision,
    ...(definition.idempotency === "required"
      ? { idempotencyKey: \`delegation-\${claim.grantId}\`, correlationId: \`delegation-\${claim.grantId}\` }
      : {}),
  };
  const result = await delegation.invoke(credential, claim, operationId, input, command);
  validateOutput(definition, result);
  return result;
}

class ExtensionAdapterError extends ModelOperationError {}

export async function invoke${manifest.model.name}Extension(
  runtime: ${manifest.model.name}ExtensionRuntime | undefined,
  extensionId: ${manifest.model.name}ExtensionOperationId,
  value: unknown,
): Promise<${extensionResultUnion}> {
  const definition = extensionDefinitions.find((candidate) => candidate.id === extensionId);
  if (!definition) {
    throw new ValidationError("Unknown extension tool", "ML_VALIDATION", "extension:operation");
  }
  const input = validateExtensionInput(definition, value);
  if (!runtime || !await runtime.supports(definition.id, definition.contractRevision)) {
    throw new ExtensionAdapterError(
      "The host has not registered this exact extension contract",
      "ML_EXTENSION_UNAVAILABLE",
      "extension:registration",
    );
  }
  if (!await runtime.authorize(definition.id, input)) {
    throw new AuthorizationError("The caller is not authorized for this extension", "ML_EXTENSION_AUTHORIZATION", "extension:authorization");
  }
  const result = await runtime.invoke(definition.id, input, {
    invocationId: globalThis.crypto.randomUUID(),
    contractRevision: definition.contractRevision,
    declaredAuthorizationContext: definition.authorization.declaredContext,
    retry: definition.reliability.retry,
  });
  validateExtensionResult(definition, result);
  return {
    $schema: "https://modellang.dev/schemas/extension-tool-result.schema.json",
    extensionToolResultVersion: 1,
    catalogVersion: 7,
    model: ${JSON.stringify(manifest.model)},
    extensionId: definition.id,
    contractRevision: definition.contractRevision,
    kind: "hostExtensionResult",
    authority: "none",
    execution: {
      implementation: "hostProvided",
      generatedImplementation: false,
      authorization: "hostEnforced",
      contractConformance: "hostAsserted",
      evidence: "hostOwned",
    },
    result,
  } as ${extensionResultUnion};
}

function currentStateResource(definition: OperationDefinition, data: unknown, retrievedAt: string) {
  return {
    $schema: "https://modellang.dev/schemas/agent-resource.schema.json" as const,
    resourceVersion: 1 as const,
    catalogVersion: 7 as const,
    model: ${JSON.stringify(manifest.model)},
    operationId: definition.id,
    kind: "queryResult" as const,
    authority: "none" as const,
    view: {
      audience: "agent" as const,
      subjectSpecific: true as const,
      authorizationFiltered: true as const,
      containsCurrentState: true as const,
      containsInput: false as const,
      containsAuthenticatedIdentity: false as const,
      containsExtensions: false as const,
      grantsAuthority: false as const,
      runtimeAuthorizationRequired: true as const,
    },
    freshness: {
      mode: "pointInTime" as const,
      retrievedAt,
      maxAgeSeconds: 0 as const,
      revalidate: "beforeReuse" as const,
    },
    data,
  };
}

export async function assemble${manifest.model.name}PublicDecisionTrace(
  executor: ${manifest.model.name}OperationExecutor,
  value: unknown,
  now: () => Date = () => new Date(),
): Promise<${manifest.model.name}PublicDecisionTrace> {
  const candidate = validatePublicDecisionTraceRequest(value);
  const definition = operationDefinitions.find((item) =>
    item.endpoint === "execution" && item.action && item.id === candidate.operationId)!;
  const decision = validateDecision(
    definition,
    await executor.assess(candidate.operationId, candidate.input as unknown as Readonly<Record<string, unknown>>, {
      expectedRevision: candidate.expectedRevision,
    }),
  );
  const contract = publicDecisionTraceActionContracts.find((item) => item.operationId === candidate.operationId)!;
  const requirementOutcomes = contract.preconditionRuleIds.map((): "passed" | "failed" | "notEvaluated" =>
    decision.status === "denied" ? "notEvaluated" : "passed");
  if (decision.status === "notApplicable") {
    const failedIndex = (contract.preconditionRuleIds as readonly string[]).indexOf(decision.explanation!.ruleId);
    if (failedIndex < 0) throw new Error("Applicability trace contains an unknown requirement rule");
    for (let index = failedIndex; index < requirementOutcomes.length; index += 1) {
      requirementOutcomes[index] = index === failedIndex ? "failed" : "notEvaluated";
    }
  }
  return {
    $schema: "https://modellang.dev/schemas/public-decision-trace.schema.json",
    traceVersion: 1,
    catalogVersion: 7,
    model: ${JSON.stringify(manifest.model)},
    traceId: globalThis.crypto.randomUUID(),
    kind: "applicabilityDecisionTrace",
    operationId: candidate.operationId,
    authority: "none",
    view: ${JSON.stringify(PUBLIC_DECISION_TRACE_VIEW)},
    freshness: {
      mode: "pointInTime",
      tracedAt: now().toISOString(),
      maxAgeSeconds: 0,
      revalidate: "beforeReuse",
    },
    decision,
    stages: {
      authorization: {
        ruleId: contract.authorizationRuleId,
        outcome: decision.status === "denied" ? "failed" : "passed",
      },
      requirements: contract.preconditionRuleIds.map((ruleId, index) => ({ ruleId, outcome: requirementOutcomes[index]! })),
      revision: {
        ruleId: contract.revisionRuleId,
        outcome: decision.status === "denied" || decision.status === "notApplicable"
          ? "notEvaluated"
          : decision.status === "stale"
            ? "mismatched"
            : candidate.expectedRevision === undefined ? "notRequested" : "matched",
      },
    },
    closure: ${JSON.stringify(PUBLIC_DECISION_TRACE_CLOSURE)},
  };
}

export async function assemble${manifest.model.name}TaskPacket(
  executor: ${manifest.model.name}OperationExecutor,
  value: unknown,
  now: () => Date = () => new Date(),
): Promise<${manifest.model.name}AgentTaskPacket> {
  const request = validateTaskPacketRequest(value);
  const actions: ${manifest.model.name}AgentTaskPacket["actions"][number][] = [];
  for (const candidate of request.actions) {
    const definition = operationDefinitions.find((item) =>
      item.endpoint === "execution" && item.action && item.id === candidate.operationId)!;
    const decision = validateDecision(
      definition,
      await executor.assess(candidate.operationId, candidate.input as unknown as Readonly<Record<string, unknown>>, {
        expectedRevision: candidate.expectedRevision,
      }),
    );
    const contract = taskActionContracts.find((item) => item.operationId === candidate.operationId)!;
    actions.push({ ...contract, applicability: decision } as unknown as ${manifest.model.name}AgentTaskPacket["actions"][number]);
  }
  const observations: ${manifest.model.name}AgentTaskPacket["observations"][number][] = [];
  for (const observation of request.observations) {
    const definition = operationDefinitions.find((item) =>
      item.endpoint === "execution" && !item.action && item.id === observation.operationId)!;
    const data = await executor.execute(
      definition.id,
      observation.input as unknown as Readonly<Record<string, unknown>>,
      {},
    );
    validateOutput(definition, data);
    observations.push({
      binding: observation.binding,
      operationId: definition.id,
      resource: currentStateResource(definition, data, now().toISOString()),
    } as ${manifest.model.name}AgentTaskPacket["observations"][number]);
  }
  return {
    $schema: "https://modellang.dev/schemas/agent-task-packet.schema.json",
    packetVersion: 1,
    catalogVersion: 7,
    resourceVersion: 1,
    model: ${JSON.stringify(manifest.model)},
    packetId: globalThis.crypto.randomUUID(),
    kind: "boundedTaskContext",
    authority: "none",
    view: ${JSON.stringify(TASK_PACKET_VIEW)},
    freshness: {
      mode: "pointInTime",
      assembledAt: now().toISOString(),
      maxAgeSeconds: 0,
      revalidate: "beforeReuse",
    },
    snapshot: { atomic: false, observations: "independentReads" },
    closure: ${JSON.stringify(TASK_PACKET_CLOSURE)},
    actions,
    observations,
  };
}

function normalizedRuleId(error: ModelOperationError): string | undefined {
  return error.ruleId && /^(?:authorize|require|revision|where|boundary|workflow|transition|money|transport|parameter|invariant|exclusion|idempotency|cursor|sort-profile):/.test(error.ruleId)
    ? error.ruleId
    : undefined;
}

function problem(error: unknown): { status: number; body: Record<string, unknown> } {
  let status = 500;
  let kind = "internal";
  let title = "The operation failed unexpectedly.";
  let code = "ML_INTERNAL";
  if (error instanceof ValidationError && error.code === "ML_METHOD_NOT_ALLOWED") {
    status = 405; kind = "method-not-allowed"; title = "The operation requires POST."; code = "ML_METHOD_NOT_ALLOWED";
  } else if (error instanceof ValidationError && error.code === "ML_BODY_TOO_LARGE") {
    status = 413; kind = "request-too-large"; title = "The operation input is too large."; code = "ML_BODY_TOO_LARGE";
  } else if (error instanceof ValidationError && error.code === "ML_UNSUPPORTED_MEDIA_TYPE") {
    status = 415; kind = "unsupported-media-type"; title = "Content-Type must be application/json."; code = "ML_UNSUPPORTED_MEDIA_TYPE";
  } else if (error instanceof AuthenticationError) {
    status = 401; kind = "authentication"; title = "Authentication is required."; code = "ML_AUTHENTICATION";
  } else if (error instanceof ExtensionAdapterError) {
    status = 503; kind = "extension-unavailable"; title = "The host extension implementation is unavailable."; code = "ML_EXTENSION_UNAVAILABLE";
  } else if (error instanceof IdentityBindingError) {
    status = 401; kind = "identity-binding"; title = "The authenticated identity is not bound."; code = "ML_IDENTITY_UNBOUND";
  } else if (error instanceof AuthorizationError) {
    status = 403; kind = "authorization"; title = "The caller is not authorized."; code = "ML_AUTHORIZATION";
  } else if (error instanceof PreconditionError) {
    status = 409; kind = "precondition"; title = "An operation precondition failed."; code = "ML_PRECONDITION";
  } else if (error instanceof TransitionError) {
    status = 409; kind = "transition"; title = "The workflow transition is not legal."; code = "ML_WORKFLOW";
  } else if (error instanceof StaleError) {
    status = 409; kind = "stale"; title = "The expected revision or continuation cursor is stale."; code = "ML_STALE";
  } else if (error instanceof IdempotencyConflictError) {
    status = 409; kind = "idempotency-conflict"; title = "The idempotency key conflicts with an earlier command."; code = "ML_IDEMPOTENCY_CONFLICT";
  } else if (error instanceof ConflictError) {
    status = 409; kind = "conflict"; title = "The operation conflicts with current state."; code = "ML_CONFLICT";
  } else if (error instanceof NotFoundError) {
    status = 404; kind = "not-found"; title = "A referenced model entity was not found."; code = "ML_NOT_FOUND";
  } else if (error instanceof ValidationError) {
    status = 400; kind = "validation"; title = "The operation input is invalid."; code = "ML_VALIDATION";
  } else if (error instanceof InvariantError) {
    status = 422; kind = "invariant"; title = "The operation would violate a model invariant."; code = "ML_INVARIANT";
  }
  const body: Record<string, unknown> = {
    type: \`https://modellang.dev/problems/\${kind}\`,
    title,
    status,
    code,
  };
  if (error instanceof ModelOperationError) {
    if (error.code && /^ML_[A-Z0-9_]+$/.test(error.code)) body.code = error.code;
    const ruleId = normalizedRuleId(error);
    if (ruleId) body.ruleId = ruleId;
  }
  return { status, body };
}

function problemResponse(error: unknown, headers: Record<string, string> = {}): Response {
  const failure = problem(error);
  return Response.json(failure.body, {
    status: failure.status,
    headers: { "content-type": "application/problem+json", ...headers },
  });
}

function escapeRegExp(value: string): string {
  const syntax = ".*+?^$" + "{}()|[]\\\\";
  return [...value].map((character) => syntax.includes(character) ? "\\\\" + character : character).join("");
}

async function readJson(request: Request, maxBodyBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new ValidationError("Operation input exceeds the configured size limit", "ML_BODY_TOO_LARGE", "transport:request_body");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    throw new ValidationError("Operation input exceeds the configured size limit", "ML_BODY_TOO_LARGE", "transport:request_body");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("Operation input is not valid JSON", "ML_INVALID_JSON", "transport:request_body");
  }
}

export function create${manifest.model.name}HttpHandler(
  authenticate: ${manifest.model.name}Authenticator,
  options: ${manifest.model.name}HttpHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const basePath = options.basePath?.replace(/\\/$/, "") ?? "";
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const now = options.now ?? (() => new Date());
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const subjectCapabilityRequest = path === \`\${basePath}${SUBJECT_CAPABILITY_ROUTE}\`;
    const taskPacketRequest = path === \`\${basePath}${TASK_PACKET_ROUTE}\`;
    const publicDecisionTraceRequest = path === \`\${basePath}${PUBLIC_DECISION_TRACE_ROUTE}\`;
    const extensionDefinition = extensionDefinitions.find((candidate) => \`\${basePath}\${candidate.route}\` === path);
    const agentNoStoreHeaders: Record<string, string> = publicDecisionTraceRequest || extensionDefinition
      ? { "cache-control": "no-store" }
      : {};
    const delegationIssueRequest = path === \`\${basePath}${DELEGATION_ROUTE}\`;
    const delegationRevokeMatch = new RegExp(\`^\${escapeRegExp(basePath)}${DELEGATION_REVOKE_ROUTE_PREFIX}([0-9a-fA-F-]{36})/revoke$\`).exec(path);
    const definition = operationDefinitions.find((candidate) => \`\${basePath}\${candidate.route}\` === path);
    if (!definition && !extensionDefinition && !subjectCapabilityRequest && !taskPacketRequest && !publicDecisionTraceRequest
      && !delegationIssueRequest && !delegationRevokeMatch) {
      return problemResponse(new NotFoundError("Unknown ModelLang operation", "ML_OPERATION_NOT_FOUND", "transport:operation"));
    }
    if (request.method !== "POST") {
      return problemResponse(
        new ValidationError("ModelLang HTTP operations require POST", "ML_METHOD_NOT_ALLOWED", "transport:method"),
        { allow: "POST", ...agentNoStoreHeaders },
      );
    }
    const authorization = request.headers.get("authorization");
    const bearer = authorization && /^Bearer\\s+(.+)$/i.exec(authorization)?.[1];
    if (!bearer) return problemResponse(
      new AuthenticationError("Bearer authentication is required", "ML_AUTHENTICATION"),
      agentNoStoreHeaders,
    );
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return problemResponse(
        new ValidationError("Content-Type must be application/json", "ML_UNSUPPORTED_MEDIA_TYPE", "transport:content_type"),
        agentNoStoreHeaders,
      );
    }
    try {
      const authenticated = await authenticate(bearer);
      if (!authenticated) throw new AuthenticationError("Bearer authentication failed", "ML_AUTHENTICATION");
      const context = authenticatedContext(authenticated);
      const executor = context.executor;
      const body = await readJson(request, maxBodyBytes);
      const delegatedCredential = request.headers.get("delegated-capability");
      if (delegationIssueRequest) {
        if (delegatedCredential) {
          throw new AuthorizationError("Delegated capabilities cannot be re-delegated", "ML_DELEGATION_REDELEGATION", "delegation:redelegation");
        }
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Operation metadata is not accepted by delegation issuance", "ML_VALIDATION", "agent:delegation");
          }
        }
        if (!context.delegation) {
          throw new AuthorizationError("Delegation authority is not available", "ML_DELEGATION_UNAVAILABLE", "delegation:authority");
        }
        const delegation = validateDelegationRequest(body);
        const actionDefinition = operationDefinitions.find((item) =>
          item.endpoint === "execution" && item.action && item.id === delegation.action.operationId)!;
        const decision = validateDecision(
          actionDefinition,
          await executor.assess(delegation.action.operationId, delegation.action.input as unknown as Readonly<Record<string, unknown>>, {}),
        );
        if (decision.status !== "applicable") {
          return Response.json({
            type: "https://modellang.dev/problems/delegation-unavailable",
            title: "The exact action cannot currently be delegated.",
            status: 409,
            code: "ML_DELEGATION_UNAVAILABLE",
            ruleId: decision.explanation?.ruleId,
          }, { status: 409, headers: { "content-type": "application/problem+json", "cache-control": "no-store" } });
        }
        const issuedAt = Math.floor(now().getTime() / 1000);
        const inputHash = await canonicalSha256(delegation.action.input);
        const issueRequest: ${manifest.model.name}DelegationIssueRequest = {
          action: {
            operationId: delegation.action.operationId,
            input: delegation.action.input as unknown as Readonly<Record<string, unknown>>,
          },
          inputHash,
          delegate: delegation.delegate,
          audience: delegation.audience,
          issuedAt,
          notBefore: issuedAt,
          expiresAt: issuedAt + delegation.expiresInSeconds,
          revision: decision.revision!,
        };
        const issued = await context.delegation.issue(issueRequest);
        if (!validGrantId(issued.grantId)
          || typeof issued.credential !== "string" || issued.credential.length < 32 || issued.credential.length > 4096) {
          throw new Error("Delegation authority returned an invalid credential");
        }
        const result: ${manifest.model.name}DelegatedCapability = {
          $schema: "https://modellang.dev/schemas/delegated-capability.schema.json",
          delegatedCapabilityVersion: 1,
          catalogVersion: 7,
          model: ${JSON.stringify(manifest.model)},
          grantId: issued.grantId,
          operationId: issueRequest.action.operationId,
          inputHash,
          authority: "delegated",
          issuedAt,
          notBefore: issuedAt,
          expiresAt: issueRequest.expiresAt,
          revision: decision.revision!,
          audience: delegation.audience,
          constraints: ${JSON.stringify(DELEGATED_CAPABILITY_CONSTRAINTS)},
          view: ${JSON.stringify(DELEGATED_CAPABILITY_VIEW)},
          credential: { scheme: "ModelLang-Delegation", secret: true, delivery: "once", value: issued.credential },
        };
        return Response.json(result, {
          status: 201,
          headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" },
        });
      }
      if (delegationRevokeMatch) {
        if (delegatedCredential) {
          throw new AuthorizationError("Delegated capabilities cannot revoke grants", "ML_DELEGATION_REDELEGATION", "delegation:revocation");
        }
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body as object).length !== 0) {
          throw new ValidationError("Delegation revocation body must be empty", "ML_VALIDATION", "agent:delegation-revoke");
        }
        if (!context.delegation) {
          throw new AuthorizationError("Delegation authority is not available", "ML_DELEGATION_UNAVAILABLE", "delegation:authority");
        }
        const grantId = delegationRevokeMatch[1]!;
        if (!validGrantId(grantId)) {
          throw new ValidationError("Delegation grant ID is invalid", "ML_VALIDATION", "agent:delegation-grant");
        }
        const result = await context.delegation.revoke(grantId);
        if (result.grantId !== grantId
          || !["revoked", "alreadyRevoked", "consumed", "expired", "notFound"].includes(result.status)
          || result.revoked !== (result.status === "revoked" || result.status === "alreadyRevoked")) {
          throw new Error("Delegation authority returned an invalid revocation result");
        }
        return Response.json(result, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (delegatedCredential) {
        if (!definition || definition.endpoint !== "execution" || !definition.action) {
          throw new AuthorizationError("Delegated capabilities are valid only for exact action execution", "ML_DELEGATION_SCOPE", "delegation:scope");
        }
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Caller command metadata is not accepted with delegated capabilities", "ML_VALIDATION", "delegation:metadata");
          }
        }
        if (!context.delegation) {
          throw new AuthorizationError("Delegated capability is unavailable", "ML_DELEGATION_INVALID", "delegation:credential");
        }
        const expectedAudience = options.delegationAudience ?? new URL(request.url).origin;
        const result = await invoke${manifest.model.name}DelegatedCapability(
          context.delegation,
          delegatedCredential,
          definition.id as ${manifest.model.name}ActionOperationId,
          body,
          expectedAudience,
          now,
        );
        return Response.json(result, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (taskPacketRequest) {
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Operation metadata is not accepted by task packets", "ML_VALIDATION", "agent:task-packet");
          }
        }
        const packet = await assemble${manifest.model.name}TaskPacket(executor, body, now);
        return Response.json(packet, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (extensionDefinition) {
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("ModelLang command metadata is not accepted by host extension tools", "ML_VALIDATION", "extension:metadata");
          }
        }
        const result = await invoke${manifest.model.name}Extension(context.extensions, extensionDefinition.id, body);
        return Response.json(result, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (publicDecisionTraceRequest) {
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Operation metadata is not accepted by public decision traces", "ML_VALIDATION", "agent:public-decision-trace");
          }
        }
        const trace = await assemble${manifest.model.name}PublicDecisionTrace(executor, body, now);
        return Response.json(trace, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (subjectCapabilityRequest) {
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Operation metadata is not accepted by subject capability views", "ML_VALIDATION", "agent:subject-capabilities");
          }
        }
        const candidates = validateSubjectCandidates(body);
        const available: ${manifest.model.name}SubjectCapabilityView["available"][number][] = [];
        const unavailable: ${manifest.model.name}SubjectCapabilityView["unavailable"][number][] = [];
        for (const candidate of candidates) {
          const candidateDefinition = operationDefinitions.find((item) =>
            item.endpoint === "execution" && item.action && item.id === candidate.operationId)!;
          const decision = validateDecision(
            candidateDefinition,
            await executor.assess(candidate.operationId, candidate.input as unknown as Readonly<Record<string, unknown>>, { expectedRevision: candidate.expectedRevision }),
          );
          if (decision.status === "applicable") {
            available.push({
              operationId: candidate.operationId,
              kind: "action",
              status: "applicable",
              applicable: true,
              authority: "none",
              revision: decision.revision!,
            });
          } else {
            unavailable.push({
              operationId: candidate.operationId,
              kind: "action",
              status: decision.status,
              applicable: false,
              authority: "none",
              ...(decision.revision ? { revision: decision.revision } : {}),
              explanation: decision.explanation!,
            });
          }
        }
        const view: ${manifest.model.name}SubjectCapabilityView = {
          $schema: "https://modellang.dev/schemas/subject-capability-view.schema.json",
          viewVersion: 1,
          catalogVersion: 7,
          model: ${JSON.stringify(manifest.model)},
          view: {
            audience: "agent",
            subjectSpecific: true,
            authorizationFiltered: true,
            inputSpecific: true,
            containsExpressions: false,
            containsResourceState: false,
            containsExtensions: false,
            grantsAuthority: false,
            runtimeAuthorizationRequired: true,
          },
          authentication: {
            required: true,
            source: "authenticatedContext",
            callerInput: false,
            identityDisclosed: false,
          },
          available,
          unavailable,
        };
        return Response.json(view, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      if (definition!.endpoint === "resource") {
        for (const header of ["if-match", "idempotency-key", "x-correlation-id", "x-causation-id"]) {
          if (request.headers.has(header)) {
            throw new ValidationError("Operation metadata is not accepted by agent resources", "ML_VALIDATION", "agent:resource");
          }
        }
        const input = validateInput(definition!, body);
        const data = await executor.execute(definition!.id, input, {});
        validateOutput(definition!, data);
        const resource = currentStateResource(definition!, data, now().toISOString());
        return Response.json(resource, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
      const input = validateInput(definition!, body);
      const revision = expectedRevision(request);
      const command = executionOptions(request, definition!, revision);
      if (definition!.endpoint === "applicability") {
        const decision = validateDecision(
          definition!,
          await executor.assess(definition!.id as ${manifest.model.name}ActionOperationId, input, { expectedRevision: command.expectedRevision }),
        );
        return Response.json(decision, {
          status: 200,
          headers: {
            "content-type": "application/json",
            ...(decision.revision ? { etag: \`"\${decision.revision}"\` } : {}),
          },
        });
      }
      const result = await executor.execute(definition!.id, input, command);
      validateOutput(definition!, result);
      return Response.json(result, {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(definition!.action && command.correlationId ? { "x-correlation-id": command.correlationId } : {}),
        },
      });
    } catch (error) {
      return problemResponse(error, publicDecisionTraceRequest || extensionDefinition || delegationIssueRequest || delegationRevokeMatch
        || request.headers.has("delegated-capability")
        ? { "cache-control": "no-store" }
        : {});
    }
  };
}
`;
}

export function generateHttp(
  manifest: OperationManifest,
  capabilities: CapabilityManifest,
  taskPacketSchemas: TaskPacketSchemas,
  taskActionContracts: readonly TaskPacketActionContract[],
  delegatedCapabilitySchemas: DelegatedCapabilitySchemas,
  publicDecisionTraceSchemas: PublicDecisionTraceSchemas,
  publicDecisionTraceActionContracts: readonly PublicDecisionTraceActionContract[],
  extensionTools: readonly AgentExtensionTool[],
): HttpOutput {
  return {
    "openapi.json": `${JSON.stringify(generateOpenApi(manifest, capabilities, taskPacketSchemas, delegatedCapabilitySchemas, publicDecisionTraceSchemas, extensionTools), null, 2)}\n`,
    "typescript/http-client.ts": generateHttpClient(manifest, extensionTools),
    "typescript/http-server.ts": generateHttpServer(manifest, capabilities, taskActionContracts, publicDecisionTraceActionContracts, extensionTools),
    "typescript/browser.ts": `export * from "./types.js";
export {
  ModelOperationError,
  AuthenticationError,
  IdentityBindingError,
  AuthorizationError,
  PreconditionError,
  TransitionError,
  InvariantError,
  ConflictError,
  IdempotencyConflictError,
  StaleError,
  NotFoundError,
  ValidationError,
  mapHttpProblem,
} from "./errors.js";
export type { ModelProblem } from "./errors.js";
export * from "./http-client.js";
export * from "./workflows.js";
export * from "./ui.js";
export * from "./capabilities.js";
`,
  };
}
