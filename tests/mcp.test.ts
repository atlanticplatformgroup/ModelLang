import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProcurementMcpHandler,
  type ProcurementMcpAuthenticator,
} from "../generated/procurement/typescript/mcp-server.js";

const endpoint = new URL("https://mcp.example.test/mcp");
const resourceMetadataUrl = "https://mcp.example.test/.well-known/oauth-protected-resource/mcp";
const queryId = "query:qry_4406b045404a48449282db804f6167a8" as const;
const queryToolName = "qry_4406b045404a48449282db804f6167a8";
const actionId = "action:act_1e35db0451b1461e941af6283d86dca2" as const;
const actionToolName = "act_1e35db0451b1461e941af6283d86dca2";
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
  it("serves catalog v3 tools with stable names and exact JSON schemas", async () => {
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
    const manifest = JSON.parse(await readFile("generated/procurement/mcp.json", "utf8")) as {
      tools: { name: string; inputSchema: object; outputSchema: object }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "act_1e35db0451b1461e941af6283d86dca2",
      "act_ed2374e822704c51a2925338253d05d2",
      "act_d39dbb883b5f4019b9027b85add3de47",
      queryToolName,
    ]);
    for (const tool of result.tools) {
      const binding = manifest.tools.find((candidate) => candidate.name === tool.name)!;
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
    expect(authenticate).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
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
      catalogVersion: 3,
      model: { id: "model:Procurement", version: "0.41.0" },
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
    expect(result.isError).not.toBe(true);
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
