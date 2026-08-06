import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createProcurementHttpHandler,
  type ProcurementExtensionRuntime,
  type ProcurementOperationExecutor,
} from "../generated/procurement/typescript/http-server.js";
import { createProcurementMcpHandler } from "../generated/procurement/typescript/mcp-server.js";
import { AuthorizationError } from "../generated/procurement/typescript/errors.js";

const actionId = "action:act_1e35db0451b1461e941af6283d86dca2" as const;
const queryId = "query:qry_4406b045404a48449282db804f6167a8" as const;
const extensionId = "extension:ext_54d694c9a0a274dc79c6168e47d25968" as const;
const actionRoute = "https://agent.example/operations/actions/act_1e35db0451b1461e941af6283d86dca2";
const queryRoute = "https://agent.example/operations/queries/qry_4406b045404a48449282db804f6167a8";
const resourceRoute = "https://agent.example/agent/resources/queries/qry_4406b045404a48449282db804f6167a8";
const packetRoute = "https://agent.example/agent/task-packets";
const traceRoute = "https://agent.example/agent/decision-traces";
const extensionRoute = "https://agent.example/agent/extensions/ext_54d694c9a0a274dc79c6168e47d25968";
const requestId = "00000000-0000-4000-8000-000000000010";
const callerId = "00000000-0000-4000-8000-000000000001";

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer agent", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const applicable = {
  operationId: actionId,
  status: "applicable",
  applicable: true,
  authority: "none",
  revision: "rev:1:0123456789abcdef0123456789abcdef",
} as const;

describe("agent-adversarial-v1", () => {
  it("keeps private implementation and runtime authority out of every discovery artifact", async () => {
    const [catalog, mcp] = await Promise.all([
      readFile("generated/procurement/agent-tools.json", "utf8"),
      readFile("generated/procurement/mcp.json", "utf8"),
    ]);
    expect(`${catalog}\n${mcp}`).not.toMatch(
      /supplier-risk\/review|tests\/procurement|principal_id|identity_subject|query_audit|action_audit|decision_evidence|event_outbox|bearerToken|delegation-[0-9a-f-]{16,}/i,
    );
    const parsedCatalog = JSON.parse(catalog) as { view: { grantsAuthority: boolean }; tools: { applicability?: { grantsAuthority: boolean } }[]; extensionTools: { conformance: { discoveryGrantsAuthority: boolean; resultGrantsAuthority: boolean } }[] };
    expect(parsedCatalog.view.grantsAuthority).toBe(false);
    expect(parsedCatalog.tools.every((tool) => tool.applicability?.grantsAuthority !== true)).toBe(true);
    expect(parsedCatalog.extensionTools.every((tool) =>
      !tool.conformance.discoveryGrantsAuthority && !tool.conformance.resultGrantsAuthority)).toBe(true);
  });

  it("rejects identity injection across actions, queries, resources, packets, traces, and extensions before runtime", async () => {
    const execute = vi.fn(async () => []);
    const assess = vi.fn(async () => applicable);
    const supports = vi.fn(async () => true);
    const authorize = vi.fn(async () => true);
    const invoke = vi.fn(async () => true);
    const handler = createProcurementHttpHandler(async () => ({
      executor: { execute, assess },
      extensions: { supports, authorize, invoke },
    }));
    const attacks = [
      post(actionRoute, { actor: callerId, amount: { currency: "USD", amount: "1.00" } }, { "idempotency-key": "attack-action" }),
      post(queryRoute, { actor: callerId }),
      post(resourceRoute, { actor: callerId }),
      post(packetRoute, { actions: [], observations: [], actor: callerId }),
      post(traceRoute, { action: { operationId: actionId, input: { amount: { currency: "USD", amount: "1.00" } } }, actor: callerId }),
      post(extensionRoute, { request: requestId, requestedBy: callerId, actor: callerId }),
    ];
    for (const attack of attacks) {
      const response = await handler(attack);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain(callerId);
    }
    expect(execute).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled();
    expect(supports).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects command and delegation metadata on every non-action contract", async () => {
    const execute = vi.fn(async () => []);
    const assess = vi.fn(async () => applicable);
    const extensions: ProcurementExtensionRuntime = {
      supports: vi.fn(async () => true),
      authorize: vi.fn(async () => true),
      invoke: vi.fn(async () => true),
    };
    const handler = createProcurementHttpHandler(async () => ({ executor: { execute, assess }, extensions }));
    const bodies = new Map([
      [queryRoute, {}],
      [resourceRoute, {}],
      [packetRoute, { actions: [{ operationId: actionId, input: { amount: { currency: "USD", amount: "1.00" } } }], observations: [] }],
      [traceRoute, { action: { operationId: actionId, input: { amount: { currency: "USD", amount: "1.00" } } } }],
      [extensionRoute, { request: requestId, requestedBy: callerId }],
    ]);
    for (const [route, body] of bodies) {
      const command = await handler(post(route, body, { "idempotency-key": "metadata-confusion" }));
      expect(command.status).toBe(400);
      const delegation = await handler(post(route, body, { "delegated-capability": "x".repeat(64) }));
      expect(delegation.status).toBe(403);
      expect(delegation.headers.get("cache-control")).toBe("no-store");
    }
    expect(execute).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled();
  });

  it("does not turn a favorable preflight decision into reusable execution authority", async () => {
    let currentlyAuthorized = true;
    const execute = vi.fn<ProcurementOperationExecutor["execute"]>(async () => {
      if (!currentlyAuthorized) {
        throw new AuthorizationError("state changed", "ML_AUTHORIZATION", `authorize:${actionId}`);
      }
      return {};
    });
    const assess = vi.fn(async () => applicable);
    const handler = createProcurementHttpHandler(async () => ({ execute, assess }));
    const preflight = await handler(post(`${actionRoute}/applicability`, { amount: { currency: "USD", amount: "1.00" } }));
    expect(preflight.status).toBe(200);
    expect(await preflight.json()).toMatchObject({ status: "applicable", authority: "none" });
    currentlyAuthorized = false;
    const execution = await handler(post(
      actionRoute,
      { amount: { currency: "USD", amount: "1.00" } },
      { "idempotency-key": "preflight-is-not-authority", "if-match": `"${applicable.revision}"` },
    ));
    expect(execution.status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await execution.json())).not.toContain("state changed");
  });

  it("isolates host extension adapters by authenticated request context", async () => {
    const invokedByA = vi.fn(async () => true);
    const invokedByB = vi.fn(async () => false);
    const extension = (token: string): ProcurementExtensionRuntime => ({
      supports: async (id) => id === extensionId,
      authorize: async () => token === "agent-a",
      invoke: token === "agent-a" ? invokedByA : invokedByB,
    });
    const executor = { execute: vi.fn(), assess: vi.fn() } satisfies ProcurementOperationExecutor;
    const handler = createProcurementHttpHandler(async (token) => ({ executor, extensions: extension(token) }));
    const body = { request: requestId, requestedBy: callerId };
    const allowed = await handler(post(extensionRoute, body, { authorization: "Bearer agent-a" }));
    const denied = await handler(post(extensionRoute, body, { authorization: "Bearer agent-b" }));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ result: true, authority: "none" });
    expect(denied.status).toBe(403);
    expect(invokedByA).toHaveBeenCalledTimes(1);
    expect(invokedByB).not.toHaveBeenCalled();
  });

  it("preserves metadata separation through authenticated MCP requests", async () => {
    const endpoint = new URL("https://agent.example/mcp");
    const execute = vi.fn(async () => []);
    const assess = vi.fn(async () => applicable);
    const invoke = vi.fn(async () => true);
    const handler = createProcurementMcpHandler(async (token) => token === "agent" ? {
      authInfo: {
        token,
        clientId: "agent-adversarial-v1",
        scopes: ["modellang"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(endpoint.href),
      },
      executor: { execute, assess },
      extensions: { supports: async () => true, authorize: async () => true, invoke },
    } : null, { resourceServerUrl: endpoint.href });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: "Bearer agent" } },
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: "agent-adversarial-v1", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(transport);
      const queryAttack = await client.callTool({
        name: queryId.slice(queryId.indexOf(":") + 1),
        arguments: {},
        _meta: { "dev.modellang/idempotencyKey": "not-query-metadata" },
      });
      expect(queryAttack.isError).toBe(true);
      const extensionAttack = await client.callTool({
        name: extensionId.slice(extensionId.indexOf(":") + 1),
        arguments: { request: requestId, requestedBy: callerId },
        _meta: { "dev.modellang/delegatedCapability": "not-extension-authority" },
      });
      expect(extensionAttack.isError).toBe(true);
      const traceAttack = await client.callTool({
        name: "modellang_public_decision_trace",
        arguments: { action: { operationId: actionId, input: { amount: { currency: "USD", amount: "1.00" } } } },
        _meta: { "dev.modellang/delegatedCapability": "not-trace-authority" },
      });
      expect(traceAttack.isError).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      expect(assess).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), handler.close()]);
    }
  });
});
