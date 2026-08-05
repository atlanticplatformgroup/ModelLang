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
} from "../agent-routes.js";
import type { TaskPacketActionContract, TaskPacketSchemas } from "../task-packet.js";
import { TASK_PACKET_CLOSURE, TASK_PACKET_VIEW } from "../task-packet.js";

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
      catalogVersion: { const: 4 },
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
              { $ref: "#/components/parameters/ExpectedRevision" },
              ...(operation.reliability.idempotency === "required" ? [{ $ref: "#/components/parameters/IdempotencyKey" }] : []),
              { $ref: "#/components/parameters/CorrelationId" },
              { $ref: "#/components/parameters/CausationId" },
            ],
            "x-modellang-idempotency": operation.reliability.idempotency,
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
  const paths = Object.fromEntries([
    ...executionPaths,
    ...applicabilityPaths,
    ...resourcePaths,
    subjectCapabilityPath,
    taskPacketPath,
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
          required: true,
          description: "Principal-scoped retry key; it grants no authority.",
          schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" },
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
        SubjectCapabilityView: {
          type: "object",
          additionalProperties: false,
          required: ["$schema", "viewVersion", "catalogVersion", "model", "view", "authentication", "available", "unavailable"],
          properties: {
            $schema: { const: "https://modellang.dev/schemas/subject-capability-view.schema.json" },
            viewVersion: { const: 1 },
            catalogVersion: { const: 4 },
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

function generateHttpClient(manifest: OperationManifest): string {
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
  const taskObservations = manifest.operations.filter((operation) => operation.kind === "query").map((operation) =>
    `  | { readonly binding: string; readonly operationId: ${JSON.stringify(operation.id)}; readonly input: ${operationInputName(operation)} }`,
  ).join("\n");
  const taskObservationResults = manifest.operations.filter((operation) => operation.kind === "query").map((operation) =>
    `  | { readonly binding: string; readonly operationId: ${JSON.stringify(operation.id)}; readonly resource: ${manifest.model.name}AgentResource<${returnType(manifest, operation)}, ${JSON.stringify(operation.id)}> }`,
  ).join("\n");
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

export interface ${manifest.model.name}SubjectCapabilityView {
  readonly $schema: "https://modellang.dev/schemas/subject-capability-view.schema.json";
  readonly viewVersion: 1;
  readonly catalogVersion: 4;
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
  readonly catalogVersion: 4;
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
  readonly catalogVersion: 4;
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

${methods}

${assessments}

${resources}
}
`;
}

function generateHttpServer(
  manifest: OperationManifest,
  capabilities: CapabilityManifest,
  taskActionContracts: readonly TaskPacketActionContract[],
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
  ${manifest.model.name}AgentTaskPacket,
  ${manifest.model.name}SubjectCapabilityCandidate,
  ${manifest.model.name}SubjectCapabilityView,
  ${manifest.model.name}TaskPacketRequest,
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

export interface ${manifest.model.name}OperationExecutor {
  execute(operationId: ${manifest.model.name}OperationId, input: Readonly<Record<string, unknown>>, options?: ExecutionOptions): Promise<unknown>;
  assess(operationId: ${manifest.model.name}ActionOperationId, input: Readonly<Record<string, unknown>>, options?: ApplicabilityOptions): Promise<ApplicabilityDecision>;
}

export type ${manifest.model.name}Authenticator = (
  bearerToken: string,
) => ${manifest.model.name}OperationExecutor | null | Promise<${manifest.model.name}OperationExecutor | null>;

export interface ${manifest.model.name}HttpHandlerOptions {
  basePath?: string;
  maxBodyBytes?: number;
  now?: () => Date;
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

function currentStateResource(definition: OperationDefinition, data: unknown, retrievedAt: string) {
  return {
    $schema: "https://modellang.dev/schemas/agent-resource.schema.json" as const,
    resourceVersion: 1 as const,
    catalogVersion: 4 as const,
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
    catalogVersion: 4,
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
    const definition = operationDefinitions.find((candidate) => \`\${basePath}\${candidate.route}\` === path);
    if (!definition && !subjectCapabilityRequest && !taskPacketRequest) {
      return problemResponse(new NotFoundError("Unknown ModelLang operation", "ML_OPERATION_NOT_FOUND", "transport:operation"));
    }
    if (request.method !== "POST") {
      return problemResponse(
        new ValidationError("ModelLang HTTP operations require POST", "ML_METHOD_NOT_ALLOWED", "transport:method"),
        { allow: "POST" },
      );
    }
    const authorization = request.headers.get("authorization");
    const bearer = authorization && /^Bearer\\s+(.+)$/i.exec(authorization)?.[1];
    if (!bearer) return problemResponse(new AuthenticationError("Bearer authentication is required", "ML_AUTHENTICATION"));
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return problemResponse(new ValidationError("Content-Type must be application/json", "ML_UNSUPPORTED_MEDIA_TYPE", "transport:content_type"));
    }
    try {
      const executor = await authenticate(bearer);
      if (!executor) throw new AuthenticationError("Bearer authentication failed", "ML_AUTHENTICATION");
      const body = await readJson(request, maxBodyBytes);
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
          catalogVersion: 4,
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
      return problemResponse(error);
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
): HttpOutput {
  return {
    "openapi.json": `${JSON.stringify(generateOpenApi(manifest, capabilities, taskPacketSchemas), null, 2)}\n`,
    "typescript/http-client.ts": generateHttpClient(manifest),
    "typescript/http-server.ts": generateHttpServer(manifest, capabilities, taskActionContracts),
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
