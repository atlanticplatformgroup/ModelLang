import type { CapabilityManifest } from "./capability-manifest.js";
import { agentResourceRoute, applicabilityRoute, operationRoute } from "./codegen/http.js";
import type {
  ManifestOperation,
  OperationManifest,
  OperationValueType,
} from "./operation-manifest.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";
import {
  SUBJECT_CAPABILITY_MAX_CANDIDATES,
  SUBJECT_CAPABILITY_ROUTE,
  TASK_PACKET_MAX_ACTIONS,
  TASK_PACKET_MAX_OBSERVATIONS,
  TASK_PACKET_ROUTE,
} from "./agent-routes.js";

type JsonSchema = Record<string, unknown>;

interface AgentToolBase {
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  execution: {
    protocol: "http";
    method: "POST";
    path: string;
    authenticated: true;
    runtimeAuthorizationRequired: true;
  };
  errors: ManifestOperation["errors"];
  annotations: { readOnly: boolean };
}

export type AgentTool =
  | (AgentToolBase & {
      kind: "action";
      applicability: {
        protocol: "http";
        method: "POST";
        path: string;
        outcomes: ["applicable", "denied", "notApplicable", "stale"];
        authorizationRuleId: string;
        preconditionRuleIds: string[];
        revisionRuleId: string;
        grantsAuthority: false;
      };
      reliability: Extract<ManifestOperation, { kind: "action" }>["reliability"];
      emittedEventIds: string[];
    })
  | (AgentToolBase & {
      kind: "query";
      bounds: {
        cardinality: "many" | "page";
        maxItems: number;
      };
      sorting?: Extract<ManifestOperation, { kind: "query" }>["sorting"];
      disclosure?: Extract<ManifestOperation, { kind: "query" }>["disclosure"];
      readEvidence?: Extract<ManifestOperation, { kind: "query" }>["readEvidence"];
      resource: {
        protocol: "http";
        method: "POST";
        path: string;
        authenticated: true;
        subjectSpecific: true;
        authorizationFiltered: true;
        containsCurrentState: true;
        freshness: { mode: "pointInTime"; maxAgeSeconds: 0; revalidate: "beforeReuse" };
        grantsAuthority: false;
        runtimeAuthorizationRequired: true;
      };
    });

export interface AgentToolCatalog {
  $schema: "https://modellang.dev/schemas/agent-tool-catalog.schema.json";
  catalogVersion: 4;
  compilerVersion: string;
  operationManifestVersion: 11;
  capabilityManifestVersion: 10;
  model: OperationManifest["model"];
  view: {
    audience: "agent";
    static: true;
    authorizationFiltered: false;
    containsExpressions: false;
    containsCurrentState: false;
    containsExtensions: false;
    grantsAuthority: false;
    runtimeAuthorizationRequired: true;
  };
  adapter: {
    compatibility: "mcpTool";
    directProtocolConformance: false;
  };
  authentication: {
    required: true;
    source: "authenticatedContext";
    callerInput: false;
  };
  subjectView: {
    protocol: "http";
    method: "POST";
    path: "/agent/capabilities";
    authenticated: true;
    subjectSpecific: true;
    authorizationFiltered: true;
    inputSpecific: true;
    candidateKinds: ["action"];
    maxCandidates: 32;
    queryTools: "separateResourceBindings";
    containsResourceState: false;
    grantsAuthority: false;
    runtimeAuthorizationRequired: true;
  };
  taskPackets: {
    protocol: "http";
    method: "POST";
    path: "/agent/task-packets";
    packetVersion: 1;
    authenticated: true;
    subjectSpecific: true;
    authorizationFiltered: true;
    inputSpecific: true;
    actionCandidates: "exact";
    observations: "callerSelectedQueries";
    maxActions: 32;
    maxObservations: 32;
    containsCurrentState: true;
    containsOperationInput: false;
    containsObservationInput: false;
    containsAuthenticatedIdentity: false;
    closure: "explicitPartial";
    atomic: false;
    grantsAuthority: false;
    runtimeAuthorizationRequired: true;
  };
  tools: AgentTool[];
}

function enumValues(manifest: OperationManifest, enumId: string): string[] {
  const enumeration = manifest.enums.find((candidate) => candidate.id === enumId);
  if (!enumeration) throw new Error(`E6601 Missing enum '${enumId}' in agent tool catalog.`);
  return enumeration.members.map((member) => member.value);
}

function valueSchema(manifest: OperationManifest, type: OperationValueType): JsonSchema {
  if (type.kind === "entity") return { type: "string", format: "uuid" };
  if (type.kind === "enum") return { type: "string", enum: enumValues(manifest, type.enumId) };
  if (type.kind === "enumSet") {
    return {
      type: "array",
      items: { type: "string", enum: enumValues(manifest, type.enumId) },
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

function inputSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  const properties: [string, JsonSchema][] = operation.input.map((parameter) => [
    parameter.name,
    parameter.optional ? nullable(valueSchema(manifest, parameter.type)) : valueSchema(manifest, parameter.type),
  ]);
  if (operation.kind === "query" && operation.sorting) {
    properties.push([operation.sorting.input, {
      type: "string",
      enum: operation.sorting.profiles.map((profile) => profile.name),
    }]);
  }
  if (operation.kind === "query" && operation.output.cardinality === "page") {
    properties.push([operation.output.pagination.cursorInput, {
      type: "string",
      minLength: 1,
      maxLength: 4096,
      pattern: "^[A-Za-z0-9_-]+$",
    }]);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: operation.input.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
    properties: Object.fromEntries(properties),
  };
}

function entitySchema(manifest: OperationManifest, entityId: string): JsonSchema {
  const entity = manifest.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`E6602 Missing entity '${entityId}' in agent tool catalog.`);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: entity.fields.map((field) => field.name),
    properties: Object.fromEntries(entity.fields.map((field) => [
      field.name,
      field.nullable ? nullable(valueSchema(manifest, field.type)) : valueSchema(manifest, field.type),
    ])),
  };
}

function projectionSchema(
  manifest: OperationManifest,
  projectionId: string,
  stack: readonly string[] = [],
): JsonSchema {
  if (stack.includes(projectionId)) throw new Error(`E6603 Cyclic projection '${projectionId}' in agent tool catalog.`);
  const projection = manifest.projections.find((candidate) => candidate.id === projectionId);
  if (!projection) throw new Error(`E6604 Missing projection '${projectionId}' in agent tool catalog.`);
  const nextStack = [...stack, projectionId];
  return {
    type: "object",
    additionalProperties: false,
    required: projection.fields.map((field) => field.name),
    properties: Object.fromEntries(projection.fields.map((field) => {
      const schema = field.nestedProjectionId
        ? projectionSchema(manifest, field.nestedProjectionId, nextStack)
        : valueSchema(manifest, field.type);
      return [field.name, field.nullable ? nullable(schema) : schema];
    })),
  };
}

function outputSchema(manifest: OperationManifest, operation: ManifestOperation): JsonSchema {
  if (operation.kind === "action") return entitySchema(manifest, operation.output.entityId);
  const items = {
    type: "array",
    maxItems: operation.output.maxItems,
    items: projectionSchema(manifest, operation.output.projectionId),
  };
  if (operation.output.cardinality === "many") {
    return { $schema: "https://json-schema.org/draft/2020-12/schema", ...items };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items,
      nextCursor: {
        anyOf: [
          { type: "string", minLength: 1, maxLength: 4096, pattern: "^[A-Za-z0-9_-]+$" },
          { type: "null" },
        ],
      },
    },
  };
}

function execution(operation: ManifestOperation): AgentToolBase["execution"] {
  return {
    protocol: "http",
    method: "POST",
    path: operationRoute(operation),
    authenticated: true,
    runtimeAuthorizationRequired: true,
  };
}

export function generateAgentToolCatalog(
  manifest: OperationManifest,
  capabilities: CapabilityManifest,
): AgentToolCatalog {
  const tools = manifest.operations.map((operation): AgentTool => {
    const base: AgentToolBase = {
      id: operation.id,
      name: operation.name,
      description: operation.kind === "action"
        ? `Execute the ${operation.name} domain action. Runtime authorization and preconditions remain authoritative.`
        : `Read the bounded ${operation.name} projection. Runtime authorization and row policy remain authoritative.`,
      inputSchema: inputSchema(manifest, operation),
      outputSchema: outputSchema(manifest, operation),
      execution: execution(operation),
      errors: [...operation.errors],
      annotations: { readOnly: operation.kind === "query" },
    };
    if (operation.kind === "query") {
      return {
        ...base,
        kind: "query",
        bounds: { cardinality: operation.output.cardinality, maxItems: operation.output.maxItems },
        resource: {
          protocol: "http",
          method: "POST",
          path: agentResourceRoute(operation),
          authenticated: true,
          subjectSpecific: true,
          authorizationFiltered: true,
          containsCurrentState: true,
          freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
          grantsAuthority: false,
          runtimeAuthorizationRequired: true,
        },
        ...(operation.sorting ? { sorting: operation.sorting } : {}),
        ...(operation.disclosure ? { disclosure: operation.disclosure } : {}),
        ...(operation.readEvidence ? { readEvidence: operation.readEvidence } : {}),
      };
    }
    const capability = capabilities.actions.find((candidate) => candidate.operationId === operation.id);
    if (!capability) throw new Error(`E6605 Missing capability for action '${operation.id}' in agent tool catalog.`);
    return {
      ...base,
      kind: "action",
      applicability: {
        protocol: "http",
        method: "POST",
        path: applicabilityRoute(operation),
        outcomes: capability.outcomes,
        authorizationRuleId: capability.explanation.authorizationRuleId,
        preconditionRuleIds: [...capability.explanation.preconditionRuleIds],
        revisionRuleId: capability.explanation.revisionRuleId,
        grantsAuthority: false,
      },
      reliability: { ...operation.reliability },
      emittedEventIds: [...operation.emittedEventIds],
    };
  });
  return {
    $schema: "https://modellang.dev/schemas/agent-tool-catalog.schema.json",
    catalogVersion: 4,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    operationManifestVersion: manifest.manifestVersion,
    capabilityManifestVersion: capabilities.capabilityManifestVersion,
    model: { ...manifest.model },
    view: {
      audience: "agent",
      static: true,
      authorizationFiltered: false,
      containsExpressions: false,
      containsCurrentState: false,
      containsExtensions: false,
      grantsAuthority: false,
      runtimeAuthorizationRequired: true,
    },
    adapter: { compatibility: "mcpTool", directProtocolConformance: false },
    authentication: { required: true, source: "authenticatedContext", callerInput: false },
    subjectView: {
      protocol: "http",
      method: "POST",
      path: SUBJECT_CAPABILITY_ROUTE,
      authenticated: true,
      subjectSpecific: true,
      authorizationFiltered: true,
      inputSpecific: true,
      candidateKinds: ["action"],
      maxCandidates: SUBJECT_CAPABILITY_MAX_CANDIDATES,
      queryTools: "separateResourceBindings",
      containsResourceState: false,
      grantsAuthority: false,
      runtimeAuthorizationRequired: true,
    },
    taskPackets: {
      protocol: "http",
      method: "POST",
      path: TASK_PACKET_ROUTE,
      packetVersion: 1,
      authenticated: true,
      subjectSpecific: true,
      authorizationFiltered: true,
      inputSpecific: true,
      actionCandidates: "exact",
      observations: "callerSelectedQueries",
      maxActions: TASK_PACKET_MAX_ACTIONS,
      maxObservations: TASK_PACKET_MAX_OBSERVATIONS,
      containsCurrentState: true,
      containsOperationInput: false,
      containsObservationInput: false,
      containsAuthenticatedIdentity: false,
      closure: "explicitPartial",
      atomic: false,
      grantsAuthority: false,
      runtimeAuthorizationRequired: true,
    },
    tools,
  };
}
