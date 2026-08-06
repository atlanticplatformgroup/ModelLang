import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProcurementMcpHandler,
  type ProcurementMcpAuthenticator,
} from "../generated/procurement/typescript/mcp-server.js";
import type {
  ProcurementDelegatedCapabilityClaim,
  ProcurementDelegationRuntime,
  ProcurementExtensionRuntime,
} from "../generated/procurement/typescript/http-server.js";

const endpoint = new URL("https://mcp.example.test/mcp");
const resourceMetadataUrl = "https://mcp.example.test/.well-known/oauth-protected-resource/mcp";
const queryId = "query:qry_4406b045404a48449282db804f6167a8" as const;
const queryToolName = "qry_4406b045404a48449282db804f6167a8";
const actionId = "action:act_1e35db0451b1461e941af6283d86dca2" as const;
const actionToolName = "act_1e35db0451b1461e941af6283d86dca2";
const extensionId = "extension:ext_54d694c9a0a274dc79c6168e47d25968" as const;
const extensionToolName = "ext_54d694c9a0a274dc79c6168e47d25968";
const retrievedAt = "2026-08-04T20:00:00.000Z";

function authInfo(token = "valid-token") {
  return {
    token,
    clientId: "mcp-test-client",
    scopes: ["modellang"],
    expiresAt: Math.floor(new Date(retrievedAt).getTime() / 1000) + 3600,
    resource: new URL(endpoint.href),
  };
}

function createClient(fetch: typeof globalThis.fetch) {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: "Bearer valid-token" } },
    fetch,
  });
  const client = new Client(
    { name: "modellang-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  return { client, transport };
}

const closeables: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(closeables.splice(0).map((value) => value.close()));
});

describe("generated MCP adapter", () => {
  it("serves catalog v7 core and extension tools with exact JSON schemas", async () => {
    const execute = vi.fn(async () => []);
    const authenticate = vi.fn<ProcurementMcpAuthenticator>(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess: vi.fn() },
    }));
    const handler = createProcurementMcpHandler(authenticate, {
      resourceServerUrl: endpoint.href,
      resourceMetadataUrl,
      now: () => new Date(retrievedAt),
    });
    const { client, transport } = createClient((input, init) => handler.fetch(new Request(input, init)));
    closeables.push(client, handler);
    await client.connect(transport);

    const capabilities = client.getServerCapabilities();
    expect(capabilities).toHaveProperty("tools");
    expect(capabilities).not.toHaveProperty("resources");
    expect(capabilities).not.toHaveProperty("prompts");
    expect(capabilities).not.toHaveProperty("tasks");
    const result = await client.listTools();
    expect(result).toMatchObject({ ttlMs: 0, cacheScope: "private" });
    const manifest = JSON.parse(await readFile("generated/procurement/mcp.json", "utf8")) as {
      taskPacket: { name: string; inputSchema: object; outputSchema: object };
      publicDecisionTrace: { name: string; inputSchema: object; outputSchema: object };
      tools: { name: string; inputSchema: object; outputSchema: object }[];
      extensionTools: { name: string; inputSchema: object; outputSchema: object }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "act_1e35db0451b1461e941af6283d86dca2",
      "act_ed2374e822704c51a2925338253d05d2",
      "act_d39dbb883b5f4019b9027b85add3de47",
      queryToolName,
      extensionToolName,
      "modellang_task_packet",
      "modellang_public_decision_trace",
    ]);
    for (const tool of result.tools) {
      const binding = tool.name === manifest.taskPacket.name
        ? manifest.taskPacket
        : tool.name === manifest.publicDecisionTrace.name
          ? manifest.publicDecisionTrace
          : manifest.extensionTools.find((candidate) => candidate.name === tool.name)
            ?? manifest.tools.find((candidate) => candidate.name === tool.name)!;
      expect(tool.inputSchema).toEqual(binding.inputSchema);
      expect(tool.outputSchema).toEqual(binding.outputSchema);
    }
    const action = result.tools[0]!;
    expect(action).toMatchObject({
      name: actionToolName,
      title: "openRequest",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "dev.modellang/operationId": actionId,
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/runtimeAuthorizationRequired": true,
        "dev.modellang/delegatedCapabilityVersion": 1,
        "dev.modellang/delegatedInvocationMetadata": "dev.modellang/delegatedCapability",
      },
    });
    expect(action.inputSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["amount"],
    });
    expect(action.outputSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    });
    const extension = result.tools.find((tool) => tool.name === extensionToolName)!;
    expect(extension).toMatchObject({
      name: extensionToolName,
      title: "supplierRiskReview",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        "dev.modellang/kind": "extension",
        "dev.modellang/operationId": extensionId,
        "dev.modellang/extensionContractVersion": 1,
        "dev.modellang/extensionContractRevision": expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        "dev.modellang/hostAdapterRequired": true,
        "dev.modellang/generatedImplementation": false,
        "dev.modellang/implementationVerification": "hostResponsibility",
        "dev.modellang/testVerification": "hostResponsibility",
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/runtimeAuthorizationRequired": true,
      },
    });
    expect(authenticate).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("applies a private revision-bound TTL only to static MCP discovery", async () => {
    const execute = vi.fn(async () => []);
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess: vi.fn() },
    }), {
      resourceServerUrl: endpoint.href,
      discoveryCacheTtlMs: 65_000,
      now: () => new Date(retrievedAt),
    });
    const observed = new Map<string, Headers>();
    const { client, transport } = createClient(async (input, init) => {
      const request = new Request(input, init);
      const method = request.headers.get("mcp-method") ?? "unknown";
      const response = await handler.fetch(request);
      observed.set(method, new Headers(response.headers));
      return response;
    });
    closeables.push(client, handler);
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed).toMatchObject({ ttlMs: 65_000, cacheScope: "private" });

    const manifest = JSON.parse(await readFile("generated/procurement/mcp.json", "utf8")) as {
      discovery: { cache: { revision: string; variesBy: string[] } };
    };
    for (const method of ["server/discover", "tools/list"]) {
      const headers = observed.get(method);
      expect(headers?.get("cache-control")).toBe("private, max-age=65");
      expect(headers?.get("etag")).toBe(`"${manifest.discovery.cache.revision}"`);
      expect(headers?.get("vary")?.split(", ")).toEqual(manifest.discovery.cache.variesBy);
    }

    await client.callTool({ name: queryToolName, arguments: {} });
    expect(observed.get("tools/call")?.get("cache-control")).toBe("no-store");
    expect(observed.get("tools/call")?.get("etag")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);

    const createInvalid = (discoveryCacheTtlMs: number) => () => createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute: vi.fn(), assess: vi.fn() },
    }), { resourceServerUrl: endpoint.href, discoveryCacheTtlMs });
    expect(createInvalid(-1)).toThrow(RangeError);
    expect(createInvalid(1.5)).toThrow(RangeError);
    expect(createInvalid(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    const maximumHandler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute: vi.fn(), assess: vi.fn() },
    }), { resourceServerUrl: endpoint.href, discoveryCacheTtlMs: Number.MAX_SAFE_INTEGER });
    closeables.push(maximumHandler);
  });

  it("executes query tools and returns a distinct zero-age embedded resource envelope", async () => {
    const data = [{
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-07-30T12:00:00Z",
      amount: null,
      status: "DRAFT",
      approvedBy: null,
    }];
    const execute = vi.fn(async () => data);
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess: vi.fn() },
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    let cacheControl: string | null = null;
    const { client, transport } = createClient(async (input, init) => {
      const response = await handler.fetch(new Request(input, init));
      cacheControl = response.headers.get("cache-control");
      return response;
    });
    closeables.push(client, handler);
    await client.connect(transport);
    await client.listTools();

    const result = await client.callTool({ name: queryToolName, arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(data);
    const embedded = result.content.find((content) => content.type === "resource");
    expect(embedded).toBeDefined();
    if (!embedded || embedded.type !== "resource" || !("text" in embedded.resource)) return;
    const envelope = JSON.parse(embedded.resource.text) as Record<string, unknown>;
    expect(embedded.resource.uri).toMatch(
      /^modellang:\/\/\/models\/model%3AProcurement\/queries\/qry_4406b045404a48449282db804f6167a8\/reads\/[0-9a-f-]{36}$/,
    );
    expect(envelope).toMatchObject({
      resourceVersion: 1,
      catalogVersion: 7,
      model: { id: "model:Procurement", version: "0.48.0" },
      operationId: queryId,
      kind: "queryResult",
      authority: "none",
      view: {
        subjectSpecific: true,
        authorizationFiltered: true,
        containsCurrentState: true,
        containsInput: false,
        containsAuthenticatedIdentity: false,
        grantsAuthority: false,
        runtimeAuthorizationRequired: true,
      },
      freshness: {
        mode: "pointInTime",
        retrievedAt,
        maxAgeSeconds: 0,
        revalidate: "beforeReuse",
      },
      data,
    });
    expect(JSON.stringify(envelope)).not.toMatch(/valid-token|mcp-test-client|query_audit/);
    expect(cacheControl).toBe("no-store");
    expect(execute).toHaveBeenCalledWith(queryId, {}, {});
  });

  it("assembles task packets as a read-only MCP tool without claiming MCP Tasks authority", async () => {
    const data = [{
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-07-30T12:00:00Z",
      amount: null,
      status: "DRAFT",
      approvedBy: null,
    }];
    const execute = vi.fn(async () => data);
    const assess = vi.fn(async () => ({
      operationId: actionId,
      status: "applicable" as const,
      applicable: true,
      authority: "none" as const,
      revision: "rev:1:0123456789abcdef0123456789abcdef",
    }));
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess },
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    let cacheControl: string | null = null;
    const { client, transport } = createClient(async (input, init) => {
      const response = await handler.fetch(new Request(input, init));
      cacheControl = response.headers.get("cache-control");
      return response;
    });
    closeables.push(client, handler);
    await client.connect(transport);
    const listed = await client.listTools();
    const taskTool = listed.tools.find((tool) => tool.name === "modellang_task_packet")!;
    expect(taskTool).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: {
        "dev.modellang/taskPacketVersion": 1,
        "dev.modellang/closure": "explicitPartial",
        "dev.modellang/mcpTasks": false,
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/maxAgeSeconds": 0,
      },
    });

    const result = await client.callTool({
      name: "modellang_task_packet",
      arguments: {
        actions: [{ operationId: actionId, input: { amount: { currency: "USD", amount: "765432.10" } } }],
        observations: [{ binding: "current", operationId: queryId, input: {} }],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      packetVersion: 1,
      authority: "none",
      closure: { status: "partial" },
      actions: [{ operationId: actionId, applicability: { status: "applicable", authority: "none" } }],
      observations: [{ binding: "current", operationId: queryId, resource: { data } }],
    });
    const embedded = result.content.find((content) => content.type === "resource");
    expect(embedded).toBeDefined();
    if (!embedded || embedded.type !== "resource" || !("text" in embedded.resource)) return;
    expect(embedded.resource.mimeType).toBe("application/vnd.modellang.agent-task-packet+json");
    expect(embedded.resource.uri).toMatch(/^modellang:\/\/\/models\/model%3AProcurement\/task-packets\/[0-9a-f-]{36}$/);
    expect(JSON.parse(embedded.resource.text)).toEqual(result.structuredContent);
    expect(JSON.stringify(result)).not.toMatch(/765432\.10|valid-token|mcp-test-client/);
    expect(cacheControl).toBe("no-store");
    expect(assess).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(queryId, {}, {});

    const commandMetadata = await client.callTool({
      name: "modellang_task_packet",
      arguments: {
        actions: [{ operationId: actionId, input: { amount: { currency: "USD", amount: "1.00" } } }],
        observations: [],
      },
      _meta: { "dev.modellang/idempotencyKey": "not-a-command" },
    });
    expect(commandMetadata.isError).toBe(true);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns public applicability traces as zero-age embedded resources without executing actions", async () => {
    const revision = "rev:1:0123456789abcdef0123456789abcdef";
    const input = { amount: { currency: "USD", amount: "765432.10" } } as const;
    const assess = vi.fn(async () => ({
      operationId: actionId,
      status: "applicable" as const,
      applicable: true,
      authority: "none" as const,
      revision,
    }));
    const execute = vi.fn();
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess },
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    let cacheControl: string | null = null;
    const { client, transport } = createClient(async (requestInput, init) => {
      const response = await handler.fetch(new Request(requestInput, init));
      cacheControl = response.headers.get("cache-control");
      return response;
    });
    closeables.push(client, handler);
    await client.connect(transport);
    const listed = await client.listTools();
    const traceTool = listed.tools.find((tool) => tool.name === "modellang_public_decision_trace")!;
    expect(traceTool).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: {
        "dev.modellang/publicDecisionTraceVersion": 1,
        "dev.modellang/traceScope": "applicability",
        "dev.modellang/executionObserved": false,
        "dev.modellang/durableEvidence": false,
        "dev.modellang/completeDecisionTrace": false,
        "dev.modellang/grantsAuthority": false,
        "dev.modellang/maxAgeSeconds": 0,
      },
    });

    const result = await client.callTool({
      name: "modellang_public_decision_trace",
      arguments: { action: { operationId: actionId, input, expectedRevision: revision } },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      traceVersion: 1,
      catalogVersion: 7,
      kind: "applicabilityDecisionTrace",
      operationId: actionId,
      authority: "none",
      freshness: { tracedAt: retrievedAt, maxAgeSeconds: 0, revalidate: "beforeReuse" },
      decision: { status: "applicable", authority: "none", revision },
      stages: {
        authorization: { outcome: "passed" },
        requirements: [{ outcome: "passed" }],
        revision: { outcome: "matched" },
      },
      closure: { scope: "applicability", executionObserved: false, durableEvidence: false, completeDecisionTrace: false },
    });
    const embedded = result.content.find((content) => content.type === "resource");
    expect(embedded).toBeDefined();
    if (!embedded || embedded.type !== "resource" || !("text" in embedded.resource)) return;
    expect(embedded.resource.mimeType).toBe("application/vnd.modellang.public-decision-trace+json");
    expect(embedded.resource.uri).toMatch(/^modellang:\/\/\/models\/model%3AProcurement\/decision-traces\/[0-9a-f-]{36}$/);
    expect(JSON.parse(embedded.resource.text)).toEqual(result.structuredContent);
    expect(JSON.stringify(result)).not.toMatch(/765432\.10|valid-token|mcp-test-client|decision_evidence/);
    expect(cacheControl).toBe("no-store");
    expect(assess).toHaveBeenCalledWith(actionId, input, { expectedRevision: revision });
    expect(execute).not.toHaveBeenCalled();

    const metadata = await client.callTool({
      name: "modellang_public_decision_trace",
      arguments: { action: { operationId: actionId, input } },
      _meta: { "dev.modellang/delegatedCapability": "not-trace-authority" },
    });
    expect(metadata.isError).toBe(true);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it("passes namespaced command metadata while preserving the closed action input schema", async () => {
    const actionResult = {
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-08-04T20:00:00Z",
      requester: "00000000-0000-4000-8000-000000000001",
      amount: { currency: "USD", amount: "10.00" },
      status: "DRAFT",
      approvedBy: null,
      approvedByRoles: null,
      approvalObserved: false,
    };
    const execute = vi.fn(async () => actionResult);
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute, assess: vi.fn() },
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    const { client, transport } = createClient((input, init) => handler.fetch(new Request(input, init)));
    closeables.push(client, handler);
    await client.connect(transport);
    await client.listTools();

    const result = await client.callTool({
      name: actionToolName,
      arguments: { amount: { currency: "USD", amount: "10.00" } },
      _meta: {
        "dev.modellang/idempotencyKey": "mcp-test-command",
        "dev.modellang/correlationId": "mcp-test-correlation",
        "dev.modellang/causationId": "mcp-test-causation",
      },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toEqual(actionResult);
    expect(result.content.some((content) => content.type === "resource")).toBe(false);
    expect(execute).toHaveBeenCalledWith(
      actionId,
      { amount: { currency: "USD", amount: "10.00" } },
      {
        expectedRevision: undefined,
        idempotencyKey: "mcp-test-command",
        correlationId: "mcp-test-correlation",
        causationId: "mcp-test-causation",
      },
    );
  });

  it("invokes exact single-use delegated actions through authenticated MCP request metadata", async () => {
    const delegatedInput = { amount: { currency: "USD", amount: "42.00" } } as const;
    const credential = "mcp-delegated-secret-that-is-at-least-thirty-two-bytes";
    const grantId = "10000000-0000-4000-8000-000000000002";
    const nowEpoch = Math.floor(new Date(retrievedAt).getTime() / 1000);
    const canonicalInput = JSON.stringify({ amount: { amount: "42.00", currency: "USD" } });
    const claim: ProcurementDelegatedCapabilityClaim = {
      $schema: "https://modellang.dev/schemas/delegated-capability.schema.json",
      delegatedCapabilityVersion: 1,
      catalogVersion: 7,
      model: {
        id: "model:Procurement",
        name: "Procurement",
        version: "0.48.0",
        sourceHash: "sha256:376adbaa8d064194ffa8c604fcb274d288bfe3e75aa0a8693437668f78dd1c54",
      },
      grantId,
      operationId: actionId,
      inputHash: `sha256:${createHash("sha256").update(canonicalInput).digest("hex")}`,
      authority: "delegated",
      issuedAt: nowEpoch,
      notBefore: nowEpoch,
      expiresAt: nowEpoch + 60,
      revision: "rev:1:0123456789abcdef0123456789abcdef",
      audience: endpoint.href,
      constraints: {
        operation: "exact",
        input: "canonicalSha256",
        revision: "required",
        uses: 1,
        transferable: false,
        redelegation: false,
      },
    };
    const actionResult = {
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: retrievedAt,
      requester: "00000000-0000-4000-8000-000000000001",
      amount: delegatedInput.amount,
      status: "DRAFT",
      approvedBy: null,
      approvedByRoles: null,
      approvalObserved: false,
    };
    let consumed = false;
    const invoke = vi.fn(async () => {
      consumed = true;
      return actionResult;
    });
    const delegation: ProcurementDelegationRuntime = {
      issue: vi.fn(),
      revoke: vi.fn(),
      inspect: vi.fn(async (candidate) => candidate === credential && !consumed ? claim : null),
      invoke,
    };
    const directExecute = vi.fn();
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute: directExecute, assess: vi.fn() },
      delegation,
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    const { client, transport } = createClient((input, init) => handler.fetch(new Request(input, init)));
    closeables.push(client, handler);
    await client.connect(transport);

    const result = await client.callTool({
      name: actionToolName,
      arguments: delegatedInput,
      _meta: { "dev.modellang/delegatedCapability": credential },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toEqual(actionResult);
    expect(directExecute).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      credential,
      claim,
      actionId,
      delegatedInput,
      {
        expectedRevision: claim.revision,
        idempotencyKey: `delegation-${grantId}`,
        correlationId: `delegation-${grantId}`,
      },
    );

    const replay = await client.callTool({
      name: actionToolName,
      arguments: delegatedInput,
      _meta: { "dev.modellang/delegatedCapability": credential },
    });
    expect(replay.isError).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);

    consumed = false;
    const wrongInput = await client.callTool({
      name: actionToolName,
      arguments: { amount: { currency: "USD", amount: "43.00" } },
      _meta: { "dev.modellang/delegatedCapability": credential },
    });
    expect(wrongInput.isError).toBe(true);
    const delegatedQuery = await client.callTool({
      name: queryToolName,
      arguments: {},
      _meta: { "dev.modellang/delegatedCapability": credential },
    });
    expect(delegatedQuery.isError).toBe(true);
    const delegatedTaskPacket = await client.callTool({
      name: "modellang_task_packet",
      arguments: { actions: [{ operationId: actionId, input: delegatedInput }], observations: [] },
      _meta: { "dev.modellang/delegatedCapability": credential },
    });
    expect(delegatedTaskPacket.isError).toBe(true);
    const callerMetadata = await client.callTool({
      name: actionToolName,
      arguments: delegatedInput,
      _meta: {
        "dev.modellang/delegatedCapability": credential,
        "dev.modellang/idempotencyKey": "caller-controlled",
      },
    });
    expect(callerMetadata.isError).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("invokes extension tools only through an exact, authorized host adapter", async () => {
    const input = {
      request: "00000000-0000-4000-8000-000000000010",
      requestedBy: "00000000-0000-4000-8000-000000000001",
    };
    const supports = vi.fn<ProcurementExtensionRuntime["supports"]>(async () => true);
    const authorize = vi.fn<ProcurementExtensionRuntime["authorize"]>(async () => true);
    const invoke = vi.fn<ProcurementExtensionRuntime["invoke"]>(async () => true);
    const handler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute: vi.fn(), assess: vi.fn() },
      extensions: { supports, authorize, invoke },
    }), {
      resourceServerUrl: endpoint.href,
      now: () => new Date(retrievedAt),
    });
    const { client, transport } = createClient((requestInput, init) => handler.fetch(new Request(requestInput, init)));
    closeables.push(client, handler);
    await client.connect(transport);

    const result = await client.callTool({ name: extensionToolName, arguments: input });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      $schema: "https://modellang.dev/schemas/extension-tool-result.schema.json",
      extensionToolResultVersion: 1,
      catalogVersion: 7,
      extensionId,
      contractRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      kind: "hostExtensionResult",
      authority: "none",
      execution: {
        implementation: "hostProvided",
        generatedImplementation: false,
        authorization: "hostEnforced",
        contractConformance: "hostAsserted",
        evidence: "hostOwned",
      },
      result: true,
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result._meta).toMatchObject({
      "dev.modellang/cacheControl": "no-store",
      "dev.modellang/hostAdapterRequired": true,
      "dev.modellang/generatedImplementation": false,
      "dev.modellang/grantsAuthority": false,
    });
    const envelope = result.structuredContent as { contractRevision: string };
    expect(supports).toHaveBeenCalledWith(extensionId, envelope.contractRevision);
    expect(authorize).toHaveBeenCalledWith(extensionId, input);
    expect(invoke).toHaveBeenCalledWith(extensionId, input, {
      invocationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      contractRevision: envelope.contractRevision,
      declaredAuthorizationContext: "serviceIdentity",
      retry: "hostManaged",
    });

    const extensionSchema = JSON.parse(await readFile("schemas/extension-tool-result.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true, formats: { uuid: true } }).compile(extensionSchema);
    expect(validate(result.structuredContent), JSON.stringify(validate.errors)).toBe(true);

    const metadata = await client.callTool({
      name: extensionToolName,
      arguments: input,
      _meta: { "dev.modellang/idempotencyKey": "caller-owned-command" },
    });
    expect(metadata.isError).toBe(true);
    const delegated = await client.callTool({
      name: extensionToolName,
      arguments: input,
      _meta: { "dev.modellang/delegatedCapability": "not-valid-for-extensions" },
    });
    expect(delegated.isError).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);

    authorize.mockResolvedValueOnce(false);
    expect((await client.callTool({ name: extensionToolName, arguments: input })).isError).toBe(true);
    supports.mockResolvedValueOnce(false);
    expect((await client.callTool({ name: extensionToolName, arguments: input })).isError).toBe(true);
    invoke.mockResolvedValueOnce("not-a-boolean");
    expect((await client.callTool({ name: extensionToolName, arguments: input })).isError).toBe(true);

    const missingHandler = createProcurementMcpHandler(async () => ({
      authInfo: authInfo(),
      executor: { execute: vi.fn(), assess: vi.fn() },
    }), { resourceServerUrl: endpoint.href, now: () => new Date(retrievedAt) });
    const missingClient = createClient((requestInput, init) => missingHandler.fetch(new Request(requestInput, init)));
    closeables.push(missingClient.client, missingHandler);
    await missingClient.client.connect(missingClient.transport);
    const unavailable = await missingClient.client.callTool({ name: extensionToolName, arguments: input });
    expect(unavailable.isError).toBe(true);
    expect(JSON.stringify(unavailable.content)).toContain("ML_EXTENSION_UNAVAILABLE");
  });

  it("authenticates every protocol request and rejects expired or wrong-audience tokens", async () => {
    const authenticate = vi.fn<ProcurementMcpAuthenticator>();
    const handler = createProcurementMcpHandler(authenticate, {
      resourceServerUrl: endpoint.href,
      resourceMetadataUrl,
      now: () => new Date(retrievedAt),
    });
    closeables.push(handler);
    const unauthenticated = await handler.fetch(new Request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
    }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(`resource_metadata="${resourceMetadataUrl}"`);
    expect(authenticate).not.toHaveBeenCalled();

    const expired = createProcurementMcpHandler(async () => ({
      authInfo: { ...authInfo(), expiresAt: Math.floor(new Date(retrievedAt).getTime() / 1000) - 1 },
      executor: { execute: vi.fn(), assess: vi.fn() },
    }), { resourceServerUrl: endpoint.href, now: () => new Date(retrievedAt) });
    const wrongAudience = createProcurementMcpHandler(async () => ({
      authInfo: { ...authInfo(), resource: new URL("https://other.example/mcp") },
      executor: { execute: vi.fn(), assess: vi.fn() },
    }), { resourceServerUrl: endpoint.href, now: () => new Date(retrievedAt) });
    closeables.push(expired, wrongAudience);
    const protocolRequest = new Request(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }),
    });
    expect((await expired.fetch(protocolRequest.clone())).status).toBe(401);
    expect((await wrongAudience.fetch(protocolRequest.clone())).status).toBe(401);
  });
});
