import { createHash } from "node:crypto";
import type { AgentToolCatalog } from "./agent-tool-catalog.js";
import type { GeneratedFiles } from "./build.js";
import type { TaskPacketSchemas } from "./task-packet.js";
import type { DelegatedCapabilitySchemas } from "./delegated-capability.js";
import type { PublicDecisionTraceSchemas } from "./public-decision-trace.js";
import { stableJson } from "./ir.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";

type JsonSchema = Record<string, unknown>;

interface McpToolBinding {
  name: string;
  operationId: string;
  authoredName: string;
  kind: "action" | "query";
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: boolean;
    openWorldHint: false;
  };
  executionMetadata: {
    location: "requestMeta";
    expectedRevision: "dev.modellang/expectedRevision";
    idempotencyKey: "dev.modellang/idempotencyKey";
    correlationId: "dev.modellang/correlationId";
    causationId: "dev.modellang/causationId";
    idempotency: "required" | "unsupported";
  };
  resource?: {
    delivery: "embeddedToolResult";
    envelopeVersion: 1;
    mimeType: "application/vnd.modellang.agent-resource+json";
    containsCurrentState: true;
    uriContainsInput: false;
    freshness: { mode: "pointInTime"; maxAgeSeconds: 0; revalidate: "beforeReuse" };
    grantsAuthority: false;
  };
}

interface McpExtensionToolBinding {
  name: string;
  operationId: string;
  authoredName: string;
  kind: "extension";
  description: string;
  contractVersion: 1;
  contractRevision: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: true;
  };
  execution: {
    implementation: "hostAdapterRequired";
    generatedImplementation: false;
    runtimeAuthorizationRequired: true;
    grantsAuthority: false;
  };
}

export interface McpAdapterManifest {
  $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/mcp-adapter.schema.json";
  adapterVersion: 6;
  compilerVersion: string;
  protocolVersion: "2026-07-28";
  catalogVersion: 7;
  resourceEnvelopeVersion: 1;
  taskPacketVersion: 1;
  delegatedCapabilityVersion: 1;
  publicDecisionTraceVersion: 1;
  extensionToolResultVersion: 1;
  model: AgentToolCatalog["model"];
  transport: {
    kind: "streamableHttp";
    stateless: true;
    path: "/mcp";
    legacyProtocol: "stateless";
  };
  authentication: {
    requiredPerRequest: true;
    scheme: "bearer";
    oauthResourceServer: "hostProvided";
    audienceBound: true;
    callerInput: false;
    tokenForwarding: false;
  };
  discovery: {
    static: true;
    authorizationFiltered: false;
    grantsAuthority: false;
    runtimeAuthorizationRequired: true;
    cache: {
      methods: ["server/discover", "tools/list"];
      revision: string;
      revisionHeader: "ETag";
      ttlUnit: "milliseconds";
      defaultTtlMs: 0;
      cacheScope: "private";
      runtimeConfigurable: true;
      responseKindSpecific: true;
      variesBy: ["Authorization", "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"];
    };
  };
  capabilities: {
    tools: { listChanged: false; exactCatalogSchemas: true };
    embeddedResources: {
      delivery: "embeddedToolResult";
      templates: false;
      subscriptions: false;
      listChanged: false;
    };
    taskPackets: {
      modelLangContract: true;
      mcpTasks: false;
      delivery: "embeddedToolResult";
      maxAgeSeconds: 0;
    };
    delegatedCapabilities: {
      issuance: "httpOnly";
      invocation: "authenticatedRequestMetadata";
      exactActionAndInput: true;
      maxUses: 1;
      redelegation: false;
    };
    publicDecisionTraces: {
      modelLangContract: true;
      delivery: "embeddedToolResult";
      scope: "applicability";
      maxAgeSeconds: 0;
      durableEvidence: false;
    };
    extensionTools: {
      modelLangContract: true;
      hostAdapterRequired: true;
      hostAuthorizationRequired: true;
      generatedImplementations: 0;
      implementationVerification: "hostResponsibility";
      testVerification: "hostResponsibility";
    };
    prompts: false;
    tasks: false;
  };
  taskPacket: {
    name: "modellang_task_packet";
    kind: "taskPacketAssembler";
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    annotations: {
      readOnlyHint: true;
      destructiveHint: false;
      idempotentHint: false;
      openWorldHint: false;
    };
    resource: {
      delivery: "embeddedToolResult";
      packetVersion: 1;
      mimeType: "application/vnd.modellang.agent-task-packet+json";
      uriContainsInput: false;
      freshness: { mode: "pointInTime"; maxAgeSeconds: 0; revalidate: "beforeReuse" };
      grantsAuthority: false;
    };
  };
  delegatedCapabilities: {
    version: 1;
    issuePath: "/agent/delegations";
    revokePathTemplate: "/agent/delegations/{grantId}/revoke";
    issueInputSchema: Record<string, unknown>;
    issueOutputSchema: Record<string, unknown>;
    revokeOutputSchema: Record<string, unknown>;
    invocationMetadata: "dev.modellang/delegatedCapability";
    credentialScheme: "ModelLang-Delegation";
    authenticatedDelegateRequired: true;
    hostAtomicConsumeAndExecuteRequired: true;
    discoveryGrantsAuthority: false;
  };
  publicDecisionTrace: {
    name: "modellang_public_decision_trace";
    kind: "publicDecisionTrace";
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    annotations: {
      readOnlyHint: true;
      destructiveHint: false;
      idempotentHint: false;
      openWorldHint: false;
    };
    resource: {
      delivery: "embeddedToolResult";
      traceVersion: 1;
      mimeType: "application/vnd.modellang.public-decision-trace+json";
      uriContainsInput: false;
      freshness: { mode: "pointInTime"; maxAgeSeconds: 0; revalidate: "beforeReuse" };
      grantsAuthority: false;
    };
  };
  tools: McpToolBinding[];
  extensionTools: McpExtensionToolBinding[];
}

function stableMcpName(operationId: string): string {
  const separator = operationId.indexOf(":");
  const name = separator === -1 ? operationId : operationId.slice(separator + 1);
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) {
    throw new Error(`E6701 Operation '${operationId}' has no MCP-compatible stable name.`);
  }
  return name;
}

function mcpDiscoveryRevision(
  catalog: AgentToolCatalog,
  taskPacketSchemas: TaskPacketSchemas,
  publicDecisionTraceSchemas: PublicDecisionTraceSchemas,
): string {
  const contract = stableJson({
    adapterVersion: 6,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    protocolVersion: "2026-07-28",
    catalog,
    taskPacketSchemas,
    publicDecisionTraceSchemas,
  });
  return `sha256:${createHash("sha256").update(contract, "utf8").digest("hex")}`;
}

export function generateMcpAdapterManifest(
  catalog: AgentToolCatalog,
  taskPacketSchemas: TaskPacketSchemas,
  delegatedCapabilitySchemas: DelegatedCapabilitySchemas,
  publicDecisionTraceSchemas: PublicDecisionTraceSchemas,
): McpAdapterManifest {
  const discoveryRevision = mcpDiscoveryRevision(catalog, taskPacketSchemas, publicDecisionTraceSchemas);
  return {
    $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/mcp-adapter.schema.json",
    adapterVersion: 6,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    protocolVersion: "2026-07-28",
    catalogVersion: catalog.catalogVersion,
    resourceEnvelopeVersion: 1,
    taskPacketVersion: 1,
    delegatedCapabilityVersion: 1,
    publicDecisionTraceVersion: 1,
    extensionToolResultVersion: 1,
    model: { ...catalog.model },
    transport: {
      kind: "streamableHttp",
      stateless: true,
      path: "/mcp",
      legacyProtocol: "stateless",
    },
    authentication: {
      requiredPerRequest: true,
      scheme: "bearer",
      oauthResourceServer: "hostProvided",
      audienceBound: true,
      callerInput: false,
      tokenForwarding: false,
    },
    discovery: {
      static: true,
      authorizationFiltered: false,
      grantsAuthority: false,
      runtimeAuthorizationRequired: true,
      cache: {
        methods: ["server/discover", "tools/list"],
        revision: discoveryRevision,
        revisionHeader: "ETag",
        ttlUnit: "milliseconds",
        defaultTtlMs: 0,
        cacheScope: "private",
        runtimeConfigurable: true,
        responseKindSpecific: true,
        variesBy: ["Authorization", "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"],
      },
    },
    capabilities: {
      tools: { listChanged: false, exactCatalogSchemas: true },
      embeddedResources: {
        delivery: "embeddedToolResult",
        templates: false,
        subscriptions: false,
        listChanged: false,
      },
      taskPackets: {
        modelLangContract: true,
        mcpTasks: false,
        delivery: "embeddedToolResult",
        maxAgeSeconds: 0,
      },
      delegatedCapabilities: {
        issuance: "httpOnly",
        invocation: "authenticatedRequestMetadata",
        exactActionAndInput: true,
        maxUses: 1,
        redelegation: false,
      },
      publicDecisionTraces: {
        modelLangContract: true,
        delivery: "embeddedToolResult",
        scope: "applicability",
        maxAgeSeconds: 0,
        durableEvidence: false,
      },
      extensionTools: {
        modelLangContract: true,
        hostAdapterRequired: true,
        hostAuthorizationRequired: true,
        generatedImplementations: 0,
        implementationVerification: "hostResponsibility",
        testVerification: "hostResponsibility",
      },
      prompts: false,
      tasks: false,
    },
    taskPacket: {
      name: "modellang_task_packet",
      kind: "taskPacketAssembler",
      description: "Assemble authenticated exact action applicability and caller-selected current-state observations into a non-authoritative bounded task packet with explicit closure gaps.",
      inputSchema: structuredClone(taskPacketSchemas.inputSchema),
      outputSchema: structuredClone(taskPacketSchemas.outputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      resource: {
        delivery: "embeddedToolResult",
        packetVersion: 1,
        mimeType: "application/vnd.modellang.agent-task-packet+json",
        uriContainsInput: false,
        freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
        grantsAuthority: false,
      },
    },
    delegatedCapabilities: {
      version: 1,
      issuePath: "/agent/delegations",
      revokePathTemplate: "/agent/delegations/{grantId}/revoke",
      issueInputSchema: structuredClone(delegatedCapabilitySchemas.issueInputSchema),
      issueOutputSchema: structuredClone(delegatedCapabilitySchemas.issueOutputSchema),
      revokeOutputSchema: structuredClone(delegatedCapabilitySchemas.revokeOutputSchema),
      invocationMetadata: "dev.modellang/delegatedCapability",
      credentialScheme: "ModelLang-Delegation",
      authenticatedDelegateRequired: true,
      hostAtomicConsumeAndExecuteRequired: true,
      discoveryGrantsAuthority: false,
    },
    publicDecisionTrace: {
      name: "modellang_public_decision_trace",
      kind: "publicDecisionTrace",
      description: "Trace the current authenticated applicability of one exact action as ordered rule outcomes without publishing input, state values, identity, expressions, policy IDs, authority IDs, or private execution evidence.",
      inputSchema: structuredClone(publicDecisionTraceSchemas.inputSchema),
      outputSchema: structuredClone(publicDecisionTraceSchemas.outputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      resource: {
        delivery: "embeddedToolResult",
        traceVersion: 1,
        mimeType: "application/vnd.modellang.public-decision-trace+json",
        uriContainsInput: false,
        freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
        grantsAuthority: false,
      },
    },
    tools: catalog.tools.map((tool): McpToolBinding => ({
      name: stableMcpName(tool.id),
      operationId: tool.id,
      authoredName: tool.name,
      kind: tool.kind,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      outputSchema: structuredClone(tool.outputSchema),
      annotations: {
        readOnlyHint: tool.kind === "query",
        destructiveHint: false,
        idempotentHint: tool.kind === "action" && tool.reliability.idempotency === "required",
        openWorldHint: false,
      },
      executionMetadata: {
        location: "requestMeta",
        expectedRevision: "dev.modellang/expectedRevision",
        idempotencyKey: "dev.modellang/idempotencyKey",
        correlationId: "dev.modellang/correlationId",
        causationId: "dev.modellang/causationId",
        idempotency: tool.kind === "action" ? tool.reliability.idempotency : "unsupported",
      },
      ...(tool.kind === "query" ? {
        resource: {
          delivery: "embeddedToolResult",
          envelopeVersion: 1,
          mimeType: "application/vnd.modellang.agent-resource+json",
          containsCurrentState: true,
          uriContainsInput: false,
          freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
          grantsAuthority: false,
        },
      } : {}),
    })),
    extensionTools: catalog.extensionTools.map((tool): McpExtensionToolBinding => ({
      name: stableMcpName(tool.id),
      operationId: tool.id,
      authoredName: tool.name,
      kind: "extension",
      description: tool.description,
      contractVersion: 1,
      contractRevision: tool.contractRevision,
      inputSchema: structuredClone(tool.inputSchema),
      outputSchema: structuredClone(tool.outputSchema),
      annotations: {
        readOnlyHint: tool.annotations.readOnly,
        destructiveHint: tool.annotations.destructive,
        idempotentHint: tool.annotations.idempotent,
        openWorldHint: true,
      },
      execution: {
        implementation: "hostAdapterRequired",
        generatedImplementation: false,
        runtimeAuthorizationRequired: true,
        grantsAuthority: false,
      },
    })),
  };
}

function generateMcpServer(manifest: McpAdapterManifest): string {
  const modelName = manifest.model.name;
  return `// Generated by ModelLang. Do not edit.
import { randomUUID } from "node:crypto";
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type AuthInfo,
  type CallToolResult,
  type McpHttpHandler,
  type McpRequestContext,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { ExecutionOptions } from "./types.js";
import {
  assemble${modelName}PublicDecisionTrace,
  assemble${modelName}TaskPacket,
  invoke${modelName}Extension,
  invoke${modelName}DelegatedCapability,
  type ${modelName}ActionOperationId,
  type ${modelName}DelegationRuntime,
  type ${modelName}ExtensionOperationId,
  type ${modelName}ExtensionRuntime,
  type ${modelName}OperationExecutor,
  type ${modelName}OperationId,
} from "./http-server.js";
import { AuthorizationError, ModelOperationError, ValidationError } from "./errors.js";

type JsonSchema = Record<string, unknown>;

interface McpToolDefinition {
  readonly name: string;
  readonly operationId: ${modelName}OperationId;
  readonly authoredName: string;
  readonly kind: "action" | "query";
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: false;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
  readonly executionMetadata: {
    readonly idempotency: "required" | "unsupported";
  };
}

const toolDefinitions = ${JSON.stringify(manifest.tools.map((tool) => ({
    name: tool.name,
    operationId: tool.operationId,
    authoredName: tool.authoredName,
    kind: tool.kind,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    executionMetadata: { idempotency: tool.executionMetadata.idempotency },
})), null, 2)} as const satisfies readonly McpToolDefinition[];

const extensionToolDefinitions = ${JSON.stringify(manifest.extensionTools, null, 2)} as const;

const taskPacketDefinition = ${JSON.stringify(manifest.taskPacket, null, 2)} as const;
const delegatedCapabilityDefinition = ${JSON.stringify(manifest.delegatedCapabilities, null, 2)} as const;
const publicDecisionTraceDefinition = ${JSON.stringify(manifest.publicDecisionTrace, null, 2)} as const;
const discoveryCacheDefinition = ${JSON.stringify(manifest.discovery.cache, null, 2)} as const;

const expectedRevisionKey = "dev.modellang/expectedRevision";
const idempotencyKeyKey = "dev.modellang/idempotencyKey";
const correlationIdKey = "dev.modellang/correlationId";
const causationIdKey = "dev.modellang/causationId";
const delegatedCapabilityKey = "dev.modellang/delegatedCapability";
const commandMetadataKeys = [expectedRevisionKey, idempotencyKeyKey, correlationIdKey, causationIdKey] as const;
const commandMetadataPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export interface ${modelName}AuthenticatedMcpContext {
  readonly authInfo: AuthInfo;
  readonly executor: ${modelName}OperationExecutor;
  readonly delegation?: ${modelName}DelegationRuntime;
  readonly extensions?: ${modelName}ExtensionRuntime;
}

export type ${modelName}McpAuthenticator = (
  bearerToken: string,
) => ${modelName}AuthenticatedMcpContext | null | Promise<${modelName}AuthenticatedMcpContext | null>;

export interface ${modelName}McpHandlerOptions {
  readonly resourceServerUrl: string;
  readonly resourceMetadataUrl?: string;
  readonly discoveryCacheTtlMs?: number;
  readonly now?: () => Date;
  readonly onerror?: (error: Error) => void;
}

interface McpDiscoveryCachePolicy {
  readonly ttlMs: number;
  readonly cacheScope: "private";
  readonly revision: string;
}

function discoveryCachePolicy(ttlMs: number = discoveryCacheDefinition.defaultTtlMs): McpDiscoveryCachePolicy {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
    throw new RangeError("MCP discoveryCacheTtlMs must be a non-negative safe integer");
  }
  return {
    ttlMs,
    cacheScope: discoveryCacheDefinition.cacheScope,
    revision: discoveryCacheDefinition.revision,
  };
}

async function applyMcpResponseCachePolicy(
  request: Request,
  response: Response,
  discoveryCache: McpDiscoveryCachePolicy,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const method = request.headers.get("mcp-method");
  const discoveryMethod = method === "server/discover" || method === "tools/list";
  let successfulResult = false;
  if (discoveryMethod && response.ok && (response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const payload = await response.clone().json() as Record<string, unknown>;
      successfulResult = typeof payload === "object" && payload !== null
        && Object.hasOwn(payload, "result") && !Object.hasOwn(payload, "error");
    } catch {
      successfulResult = false;
    }
  }
  const cacheableDiscovery = discoveryMethod && successfulResult;
  if (!cacheableDiscovery || discoveryCache.ttlMs === 0) {
    headers.set("cache-control", "no-store");
  } else {
    const maxAgeSeconds = Math.floor(discoveryCache.ttlMs / 1000);
    headers.set("cache-control", \`private, max-age=\${maxAgeSeconds}\${maxAgeSeconds === 0 ? ", must-revalidate" : ""}\`);
  }
  if (cacheableDiscovery) {
    headers.set("etag", \`"\${discoveryCache.revision}"\`);
    const vary = new Map<string, string>();
    for (const name of (headers.get("vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
      vary.set(name.toLowerCase(), name);
    }
    for (const name of discoveryCacheDefinition.variesBy) vary.set(name.toLowerCase(), name);
    headers.set("vary", [...vary.values()].join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function metadataString(meta: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(\`MCP request metadata '\${key}' must be a string\`);
  return value;
}

function executionOptions(definition: McpToolDefinition, ctx: ServerContext): ExecutionOptions {
  const meta = ctx.mcpReq._meta;
  if (definition.kind === "query") {
    if (commandMetadataKeys.some((key) => Object.hasOwn(meta ?? {}, key))) {
      throw new Error("Command metadata is not accepted by query tools");
    }
    return {};
  }
  const expectedRevision = metadataString(meta, expectedRevisionKey);
  const idempotencyKey = metadataString(meta, idempotencyKeyKey);
  const correlationId = metadataString(meta, correlationIdKey);
  const causationId = metadataString(meta, causationIdKey);
  if (expectedRevision !== undefined && !/^rev:1:[0-9a-f]{32}$/.test(expectedRevision)) {
    throw new Error("MCP expected revision metadata is invalid");
  }
  if (definition.executionMetadata.idempotency === "required" && !idempotencyKey) {
    throw new Error(\`MCP tool '\${definition.name}' requires dev.modellang/idempotencyKey request metadata\`);
  }
  if (definition.executionMetadata.idempotency === "unsupported" && idempotencyKey !== undefined) {
    throw new Error(\`MCP tool '\${definition.name}' does not accept idempotency metadata\`);
  }
  if ([idempotencyKey, correlationId, causationId].some((value) => value !== undefined && !commandMetadataPattern.test(value))) {
    throw new Error("MCP command metadata is invalid");
  }
  return { expectedRevision, idempotencyKey, correlationId, causationId };
}

function resourceUri(operationId: string): string {
  const stableId = operationId.slice(operationId.indexOf(":") + 1);
  return \`modellang:///models/${encodeURIComponent(manifest.model.id)}/queries/\${stableId}/reads/\${randomUUID()}\`;
}

function currentStateEnvelope(definition: McpToolDefinition, data: unknown, retrievedAt: string) {
  return {
    $schema: "https://raw.githubusercontent.com/atlanticplatformgroup/ModelLang/v0.50.0/schemas/agent-resource.schema.json" as const,
    resourceVersion: 1 as const,
    catalogVersion: 7 as const,
    model: ${JSON.stringify(manifest.model)},
    operationId: definition.operationId,
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

function safeToolError(error: unknown): CallToolResult {
  const body: Record<string, unknown> = {
    error: "ModelLang tool execution failed",
    code: error instanceof ModelOperationError && typeof error.code === "string" && /^ML_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "ML_TOOL_EXECUTION",
  };
  if (error instanceof ModelOperationError
    && error.ruleId
    && /^(?:authorize|require|revision|where|boundary|workflow|transition|money|transport|parameter|invariant|exclusion|idempotency|cursor|sort-profile):/.test(error.ruleId)) {
    body.ruleId = error.ruleId;
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function build${modelName}McpServer(
  executor: ${modelName}OperationExecutor,
  delegation: ${modelName}DelegationRuntime | undefined,
  extensions: ${modelName}ExtensionRuntime | undefined,
  delegationAudience: string,
  discoveryCache: McpDiscoveryCachePolicy,
  now: () => Date,
  onerror?: (error: Error) => void,
): McpServer {
  const server = new McpServer(
    { name: ${JSON.stringify(`${modelName}-ModelLang`)}, version: ${JSON.stringify(manifest.model.version)} },
    {
      instructions: "Tool discovery, task packets, public applicability traces, and extension metadata grant no authority. Extension tools require an explicitly registered host adapter and host authorization on every invocation; ModelLang generates no extension implementation and does not verify its tests or effects. Public traces are zero-age current evaluations, not execution evidence or complete decision traces. Delegated invocation requires a separately issued exact-input credential plus authenticated delegate identity; every call revalidates current runtime authorization.",
      cacheHints: {
        "server/discover": discoveryCache,
        "tools/list": discoveryCache,
      },
    },
  );
  for (const definition of toolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.authoredName,
        description: definition.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(definition.inputSchema),
        outputSchema: fromJsonSchema<unknown>(definition.outputSchema),
        annotations: definition.annotations,
        _meta: {
          "dev.modellang/operationId": definition.operationId,
          "dev.modellang/grantsAuthority": false,
          "dev.modellang/runtimeAuthorizationRequired": true,
          ...(definition.kind === "action" ? {
            "dev.modellang/delegatedCapabilityVersion": delegatedCapabilityDefinition.version,
            "dev.modellang/delegatedInvocationMetadata": delegatedCapabilityDefinition.invocationMetadata,
          } : {}),
          ...(definition.kind === "query" ? {
            "dev.modellang/resourceEnvelopeVersion": 1,
            "dev.modellang/maxAgeSeconds": 0,
          } : {}),
        },
      },
      async (input, ctx): Promise<CallToolResult> => {
        try {
          const delegatedCredential = metadataString(ctx.mcpReq._meta, delegatedCapabilityKey);
          let data: unknown;
          if (delegatedCredential !== undefined) {
            if (definition.kind !== "action" || !delegation) {
              throw new AuthorizationError("Delegated capabilities are valid only for exact action invocation", "ML_DELEGATION_SCOPE", "delegation:scope");
            }
            if (commandMetadataKeys.some((key) => Object.hasOwn(ctx.mcpReq._meta ?? {}, key))) {
              throw new ValidationError("Caller command metadata is not accepted with delegated capabilities", "ML_VALIDATION", "delegation:metadata");
            }
            data = await invoke${modelName}DelegatedCapability(
              delegation,
              delegatedCredential,
              definition.operationId as ${modelName}ActionOperationId,
              input,
              delegationAudience,
              now,
            );
          } else {
            data = await executor.execute(
              definition.operationId,
              input,
              executionOptions(definition, ctx),
            );
          }
          if (definition.kind === "action") {
            return {
              content: [{ type: "text", text: JSON.stringify(data) }],
              structuredContent: data as never,
            };
          }
          const retrievedAt = now().toISOString();
          const envelope = currentStateEnvelope(definition, data, retrievedAt);
          const uri = resourceUri(definition.operationId);
          return {
            content: [
              { type: "text", text: JSON.stringify(data) },
              {
                type: "resource",
                resource: {
                  uri,
                  mimeType: "application/vnd.modellang.agent-resource+json",
                  text: JSON.stringify(envelope),
                  _meta: {
                    "dev.modellang/cacheControl": "no-store",
                    "dev.modellang/maxAgeSeconds": 0,
                    "dev.modellang/revalidate": "beforeReuse",
                  },
                },
              },
            ],
            structuredContent: data as never,
            _meta: {
              "dev.modellang/resourceUri": uri,
              "dev.modellang/cacheControl": "no-store",
              "dev.modellang/maxAgeSeconds": 0,
            },
          };
        } catch (error) {
          if (!(error instanceof ModelOperationError)) {
            onerror?.(error instanceof Error ? error : new Error(String(error)));
          }
          return safeToolError(error);
        }
      },
    );
  }
  for (const definition of extensionToolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.authoredName,
        description: definition.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(definition.inputSchema),
        outputSchema: fromJsonSchema<unknown>(definition.outputSchema),
        annotations: definition.annotations,
        _meta: {
          "dev.modellang/kind": "extension",
          "dev.modellang/operationId": definition.operationId,
          "dev.modellang/extensionContractVersion": 1,
          "dev.modellang/extensionContractRevision": definition.contractRevision,
          "dev.modellang/hostAdapterRequired": true,
          "dev.modellang/generatedImplementation": false,
          "dev.modellang/implementationVerification": "hostResponsibility",
          "dev.modellang/testVerification": "hostResponsibility",
          "dev.modellang/grantsAuthority": false,
          "dev.modellang/runtimeAuthorizationRequired": true,
        },
      },
      async (input, ctx): Promise<CallToolResult> => {
        try {
          if ([...commandMetadataKeys, delegatedCapabilityKey].some((key) => Object.hasOwn(ctx.mcpReq._meta ?? {}, key))) {
            throw new ValidationError("ModelLang command or delegated metadata is not accepted by host extension tools", "ML_VALIDATION", "extension:metadata");
          }
          const result = await invoke${modelName}Extension(
            extensions,
            definition.operationId as ${modelName}ExtensionOperationId,
            input,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result as never,
            _meta: {
              "dev.modellang/cacheControl": "no-store",
              "dev.modellang/hostAdapterRequired": true,
              "dev.modellang/generatedImplementation": false,
              "dev.modellang/grantsAuthority": false,
            },
          };
        } catch (error) {
          if (!(error instanceof ModelOperationError)) {
            onerror?.(error instanceof Error ? error : new Error(String(error)));
          }
          return safeToolError(error);
        }
      },
    );
  }
  server.registerTool(
    taskPacketDefinition.name,
    {
      title: "Assemble ModelLang task packet",
      description: taskPacketDefinition.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(taskPacketDefinition.inputSchema),
      outputSchema: fromJsonSchema<unknown>(taskPacketDefinition.outputSchema),
      annotations: taskPacketDefinition.annotations,
      _meta: {
        "dev.modellang/kind": taskPacketDefinition.kind,
        "dev.modellang/taskPacketVersion": 1,
        "dev.modellang/closure": "explicitPartial",
        "dev.modellang/mcpTasks": false,
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/runtimeAuthorizationRequired": true,
        "dev.modellang/maxAgeSeconds": 0,
      },
    },
    async (input, ctx): Promise<CallToolResult> => {
      try {
        if ([...commandMetadataKeys, delegatedCapabilityKey].some((key) => Object.hasOwn(ctx.mcpReq._meta ?? {}, key))) {
          throw new ValidationError("Command metadata is not accepted by task packet assembly", "ML_VALIDATION", "agent:task-packet");
        }
        const packet = await assemble${modelName}TaskPacket(executor, input, now);
        const uri = \`modellang:///models/${encodeURIComponent(manifest.model.id)}/task-packets/\${packet.packetId}\`;
        return {
          content: [
            { type: "text", text: JSON.stringify(packet) },
            {
              type: "resource",
              resource: {
                uri,
                mimeType: "application/vnd.modellang.agent-task-packet+json",
                text: JSON.stringify(packet),
                _meta: {
                  "dev.modellang/cacheControl": "no-store",
                  "dev.modellang/maxAgeSeconds": 0,
                  "dev.modellang/revalidate": "beforeReuse",
                  "dev.modellang/mcpTasks": false,
                },
              },
            },
          ],
          structuredContent: packet as never,
          _meta: {
            "dev.modellang/resourceUri": uri,
            "dev.modellang/cacheControl": "no-store",
            "dev.modellang/maxAgeSeconds": 0,
            "dev.modellang/mcpTasks": false,
          },
        };
      } catch (error) {
        if (!(error instanceof ModelOperationError)) {
          onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
        return safeToolError(error);
      }
    },
  );
  server.registerTool(
    publicDecisionTraceDefinition.name,
    {
      title: "Trace ModelLang action applicability",
      description: publicDecisionTraceDefinition.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(publicDecisionTraceDefinition.inputSchema),
      outputSchema: fromJsonSchema<unknown>(publicDecisionTraceDefinition.outputSchema),
      annotations: publicDecisionTraceDefinition.annotations,
      _meta: {
        "dev.modellang/kind": publicDecisionTraceDefinition.kind,
        "dev.modellang/publicDecisionTraceVersion": 1,
        "dev.modellang/traceScope": "applicability",
        "dev.modellang/executionObserved": false,
        "dev.modellang/durableEvidence": false,
        "dev.modellang/completeDecisionTrace": false,
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/runtimeAuthorizationRequired": true,
        "dev.modellang/maxAgeSeconds": 0,
      },
    },
    async (input, ctx): Promise<CallToolResult> => {
      try {
        if ([...commandMetadataKeys, delegatedCapabilityKey].some((key) => Object.hasOwn(ctx.mcpReq._meta ?? {}, key))) {
          throw new ValidationError("Command or delegated metadata is not accepted by public decision traces", "ML_VALIDATION", "agent:public-decision-trace");
        }
        const trace = await assemble${modelName}PublicDecisionTrace(executor, input, now);
        const uri = \`modellang:///models/${encodeURIComponent(manifest.model.id)}/decision-traces/\${trace.traceId}\`;
        return {
          content: [
            { type: "text", text: JSON.stringify(trace) },
            {
              type: "resource",
              resource: {
                uri,
                mimeType: "application/vnd.modellang.public-decision-trace+json",
                text: JSON.stringify(trace),
                _meta: {
                  "dev.modellang/cacheControl": "no-store",
                  "dev.modellang/maxAgeSeconds": 0,
                  "dev.modellang/revalidate": "beforeReuse",
                  "dev.modellang/traceScope": "applicability",
                  "dev.modellang/executionObserved": false,
                  "dev.modellang/durableEvidence": false,
                },
              },
            },
          ],
          structuredContent: trace as never,
          _meta: {
            "dev.modellang/resourceUri": uri,
            "dev.modellang/cacheControl": "no-store",
            "dev.modellang/maxAgeSeconds": 0,
            "dev.modellang/traceScope": "applicability",
            "dev.modellang/executionObserved": false,
            "dev.modellang/durableEvidence": false,
          },
        };
      } catch (error) {
        if (!(error instanceof ModelOperationError)) {
          onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
        return safeToolError(error);
      }
    },
  );
  return server;
}

function bearerChallenge(resourceMetadataUrl?: string): Response {
  const challenge = resourceMetadataUrl
    ? \`Bearer resource_metadata="\${resourceMetadataUrl.replace(/["\\\\]/g, "")}"\`
    : "Bearer";
  return Response.json(
    { error: "invalid_token", error_description: "A valid audience-bound bearer token is required." },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        "www-authenticate": challenge,
      },
    },
  );
}

function validAuthInfo(authInfo: AuthInfo, bearer: string, resourceServerUrl: URL, now: Date): boolean {
  const expectedResource = new URL(resourceServerUrl.href);
  expectedResource.hash = "";
  const actualResource = authInfo.resource ? new URL(authInfo.resource.href) : undefined;
  if (actualResource) actualResource.hash = "";
  return authInfo.token === bearer
    && authInfo.clientId.length > 0
    && Array.isArray(authInfo.scopes)
    && typeof authInfo.expiresAt === "number"
    && authInfo.expiresAt > Math.floor(now.getTime() / 1000)
    && actualResource?.href === expectedResource.href;
}

export function create${modelName}McpHandler(
  authenticate: ${modelName}McpAuthenticator,
  options: ${modelName}McpHandlerOptions,
): McpHttpHandler {
  const resourceServerUrl = new URL(options.resourceServerUrl);
  if (!/^https?:$/.test(resourceServerUrl.protocol)
    || resourceServerUrl.username || resourceServerUrl.password
    || resourceServerUrl.search || resourceServerUrl.hash) {
    throw new Error("MCP resourceServerUrl must be an HTTP(S) endpoint without credentials, query, or fragment");
  }
  const resourceMetadataUrl = options.resourceMetadataUrl
    ? new URL(options.resourceMetadataUrl).href
    : undefined;
  if (resourceMetadataUrl && !/^https?:/.test(resourceMetadataUrl)) {
    throw new Error("MCP resourceMetadataUrl must be HTTP(S)");
  }
  const now = options.now ?? (() => new Date());
  const discoveryCache = discoveryCachePolicy(options.discoveryCacheTtlMs);
  const contexts = new WeakMap<AuthInfo, { executor: ${modelName}OperationExecutor; delegation?: ${modelName}DelegationRuntime; extensions?: ${modelName}ExtensionRuntime }>();
  const handler = createMcpHandler(
    (ctx: McpRequestContext) => {
      const authInfo = ctx.authInfo;
      const authenticated = authInfo && contexts.get(authInfo);
      if (!authInfo || !authenticated) throw new Error("Authenticated ModelLang MCP context is unavailable");
      return build${modelName}McpServer(
        authenticated.executor,
        authenticated.delegation,
        authenticated.extensions,
        resourceServerUrl.href,
        discoveryCache,
        now,
        options.onerror,
      );
    },
    { legacy: "stateless", onerror: options.onerror },
  );
  return {
    ...handler,
    async fetch(request, requestOptions = {}) {
      const requestUrl = new URL(request.url);
      if (requestUrl.origin !== resourceServerUrl.origin
        || requestUrl.pathname !== resourceServerUrl.pathname
        || requestUrl.search !== resourceServerUrl.search) {
        return new Response("Not Found", { status: 404 });
      }
      const authorization = request.headers.get("authorization");
      const bearer = authorization && /^Bearer\\s+(.+)$/i.exec(authorization)?.[1];
      if (!bearer) return bearerChallenge(resourceMetadataUrl);
      let authenticated: ${modelName}AuthenticatedMcpContext | null;
      try {
        authenticated = await authenticate(bearer);
      } catch (error) {
        options.onerror?.(error instanceof Error ? error : new Error(String(error)));
        return Response.json(
          { error: "server_error" },
          { status: 500, headers: { "cache-control": "no-store", "content-type": "application/json" } },
        );
      }
      if (!authenticated || !validAuthInfo(authenticated.authInfo, bearer, resourceServerUrl, now())) {
        return bearerChallenge(resourceMetadataUrl);
      }
      const authInfo: AuthInfo = {
        ...authenticated.authInfo,
        scopes: [...authenticated.authInfo.scopes],
        ...(authenticated.authInfo.extra ? { extra: { ...authenticated.authInfo.extra } } : {}),
      };
      contexts.set(authInfo, {
        executor: authenticated.executor,
        ...(authenticated.delegation ? { delegation: authenticated.delegation } : {}),
        ...(authenticated.extensions ? { extensions: authenticated.extensions } : {}),
      });
      try {
        const response = await handler.fetch(request, { ...requestOptions, authInfo });
        return await applyMcpResponseCachePolicy(request, response, discoveryCache);
      } finally {
        contexts.delete(authInfo);
      }
    },
  };
}
`;
}

export function generateMcp(
  catalog: AgentToolCatalog,
  taskPacketSchemas: TaskPacketSchemas,
  delegatedCapabilitySchemas: DelegatedCapabilitySchemas,
  publicDecisionTraceSchemas: PublicDecisionTraceSchemas,
): GeneratedFiles {
  const manifest = generateMcpAdapterManifest(catalog, taskPacketSchemas, delegatedCapabilitySchemas, publicDecisionTraceSchemas);
  return {
    "mcp.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "typescript/mcp-server.ts": generateMcpServer(manifest),
  };
}
