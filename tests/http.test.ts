import { describe, expect, it, vi } from "vitest";
import { ProcurementHttpClient } from "../generated/procurement/typescript/http-client.js";
import {
  createProcurementHttpHandler,
  type ProcurementOperationExecutor,
} from "../generated/procurement/typescript/http-server.js";
import {
  AuthorizationError,
  IdempotencyConflictError,
  ModelOperationError,
  ValidationError,
} from "../generated/procurement/typescript/errors.js";

const openRoute = "https://example.test/operations/actions/act_1e35db0451b1461e941af6283d86dca2";
const purchaseRequest = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: "2026-07-30T12:00:00Z",
  requester: "00000000-0000-4000-8000-000000000001",
  amount: { currency: "USD", amount: "10.00" },
  status: "DRAFT",
  approvedBy: null,
  approvedByRoles: null,
};
const applicableDecision = {
  operationId: "action:act_1e35db0451b1461e941af6283d86dca2",
  status: "applicable",
  applicable: true,
  authority: "none",
  revision: "rev:1:0123456789abcdef0123456789abcdef",
} as const;
const assess = async () => applicableDecision;

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(openRoute, {
    method: "POST",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/json",
      "idempotency-key": "http-test-key",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("generated HTTP boundary", () => {
  it("authenticates context and passes only validated callable input to the stable operation ID", async () => {
    const execute = vi.fn(async () => purchaseRequest);
    const executor: ProcurementOperationExecutor = { execute, assess };
    const authenticate = vi.fn(async () => executor);
    const handler = createProcurementHttpHandler(authenticate);

    const response = await handler(request({ amount: { currency: "USD", amount: "10.00" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(purchaseRequest);
    expect(response.headers.get("x-correlation-id")).toBe("http-test-key");
    expect(authenticate).toHaveBeenCalledWith("valid");
    expect(execute).toHaveBeenCalledWith(
      "action:act_1e35db0451b1461e941af6283d86dca2",
      { amount: { currency: "USD", amount: "10.00" } },
      {
        expectedRevision: undefined,
        idempotencyKey: "http-test-key",
        correlationId: "http-test-key",
        causationId: undefined,
      },
    );
  });

  it("keeps applicability separate, authenticated, revision-aware, and non-authoritative", async () => {
    const assessOperation = vi.fn(async () => applicableDecision);
    const handler = createProcurementHttpHandler(async () => ({
      execute: async () => purchaseRequest,
      assess: assessOperation,
    }));
    const requests: Request[] = [];
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: (input, init) => {
        const incoming = new Request(input, init);
        requests.push(incoming.clone());
        return handler(incoming);
      },
    });
    const decision = await client.assessOpenRequest(
      { amount: { currency: "USD", amount: "10.00" } },
      { expectedRevision: applicableDecision.revision },
    );
    expect(decision).toEqual(applicableDecision);
    expect(decision.authority).toBe("none");
    expect(requests[0]!.url).toBe(`${openRoute}/applicability`);
    expect(requests[0]!.headers.get("if-match")).toBe(`"${applicableDecision.revision}"`);
    expect(assessOperation).toHaveBeenCalledWith(
      applicableDecision.operationId,
      { amount: { currency: "USD", amount: "10.00" } },
      { expectedRevision: applicableDecision.revision },
    );

    const malformed = await handler(request(
      { amount: { currency: "USD", amount: "10.00" } },
      { "if-match": applicableDecision.revision },
    ));
    expect(malformed.status).toBe(400);
  });

  it("rejects missing authentication and caller-shaped or malformed input before execution", async () => {
    const execute = vi.fn();
    const authenticate = vi.fn(async () => ({ execute, assess } satisfies ProcurementOperationExecutor));
    const handler = createProcurementHttpHandler(authenticate, { maxBodyBytes: 100 });

    const unauthenticated = await handler(new Request(openRoute, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    expect(unauthenticated.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();

    const missingKey = await handler(new Request(openRoute, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ amount: { currency: "USD", amount: "10.00" } }),
    }));
    expect(missingKey.status).toBe(400);
    expect(await missingKey.json()).toMatchObject({ code: "ML_IDEMPOTENCY_REQUIRED" });

    const malformedKey = await handler(request(
      { amount: { currency: "USD", amount: "10.00" } },
      { "idempotency-key": "contains spaces" },
    ));
    expect(malformedKey.status).toBe(400);
    expect(await malformedKey.json()).toMatchObject({ code: "ML_VALIDATION" });

    const applicabilityMetadata = await handler(new Request(`${openRoute}/applicability`, {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
        "idempotency-key": "not-an-applicability-input",
      },
      body: JSON.stringify({ amount: { currency: "USD", amount: "10.00" } }),
    }));
    expect(applicabilityMetadata.status).toBe(400);
    expect(await applicabilityMetadata.json()).toMatchObject({ code: "ML_IDEMPOTENCY_UNSUPPORTED" });

    const unsupportedKey = await handler(new Request(
      "https://example.test/operations/actions/act_ed2374e822704c51a2925338253d05d2",
      {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
          "idempotency-key": "unsafe-assumption",
        },
        body: JSON.stringify({ request: "00000000-0000-4000-8000-000000000010" }),
      },
    ));
    expect(unsupportedKey.status).toBe(400);
    expect(await unsupportedKey.json()).toMatchObject({ code: "ML_IDEMPOTENCY_UNSUPPORTED" });

    const spoofed = await handler(request({
      actor: "00000000-0000-4000-8000-000000000004",
      amount: { currency: "USD", amount: "10.00" },
    }));
    expect(spoofed.status).toBe(400);
    expect(await spoofed.json()).toMatchObject({
      type: "https://modellang.dev/problems/validation",
      ruleId: "transport:request_body",
    });

    const malformed = await handler(new Request(openRoute, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);

    const tooLarge = await handler(request({ amount: { currency: "USD", amount: "1".repeat(200) } }));
    expect(tooLarge.status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });

  it("round-trips typed ModelLang failures and hides unexpected server details", async () => {
    const ruleId = "authorize:action:act_1e35db0451b1461e941af6283d86dca2";
    const authorizationHandler = createProcurementHttpHandler(async () => ({
      async execute() {
        throw new AuthorizationError("raw backend detail", "42501", ruleId, new Error("secret SQL"));
      },
      assess,
    }));
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: (input, init) => authorizationHandler(new Request(input, init)),
    });

    await expect(client.openRequest(
      { amount: { currency: "USD", amount: "10.00" } },
      { idempotencyKey: "authorization-failure" },
    )).rejects.toMatchObject({
      name: AuthorizationError.name,
      code: "ML_AUTHORIZATION",
      ruleId,
    });
    const failure = await authorizationHandler(request({ amount: { currency: "USD", amount: "10.00" } }));
    expect(JSON.stringify(await failure.json())).not.toMatch(/raw backend detail|secret SQL|42501/);

    const unexpectedHandler = createProcurementHttpHandler(async () => ({
      async execute() {
        throw new Error("password=do-not-expose");
      },
      assess,
    }));
    const unexpected = await unexpectedHandler(request({ amount: { currency: "USD", amount: "10.00" } }));
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({
      type: "https://modellang.dev/problems/internal",
      title: "The operation failed unexpectedly.",
      status: 500,
      code: "ML_INTERNAL",
    });

    const malformedOutputHandler = createProcurementHttpHandler(async () => ({
      async execute() {
        return { ...purchaseRequest, databaseSecret: "do-not-expose" };
      },
      assess,
    }));
    const malformedOutput = await malformedOutputHandler(request({ amount: { currency: "USD", amount: "10.00" } }));
    expect(malformedOutput.status).toBe(500);
    expect(JSON.stringify(await malformedOutput.json())).not.toContain("databaseSecret");

    const idempotencyClient = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: async () => Response.json({
        type: "https://modellang.dev/problems/idempotency-conflict",
        title: "The idempotency key conflicts with an earlier command.",
        status: 409,
        code: "ML_IDEMPOTENCY_CONFLICT",
        ruleId: "idempotency:action:act_1e35db0451b1461e941af6283d86dca2",
      }, { status: 409, headers: { "content-type": "application/problem+json" } }),
    });
    await expect(idempotencyClient.openRequest(
      { amount: { currency: "USD", amount: "10.00" } },
      { idempotencyKey: "conflict" },
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("maps transport boundary failures to typed validation errors", async () => {
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: async () => Response.json({
        type: "https://modellang.dev/problems/unsupported-media-type",
        title: "Content-Type must be application/json.",
        status: 415,
        code: "ML_UNSUPPORTED_MEDIA_TYPE",
      }, { status: 415, headers: { "content-type": "application/problem+json" } }),
    });
    await expect(client.myRequests({})).rejects.toBeInstanceOf(ValidationError);

    const unknownClient = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: async () => Response.json({ title: "Unknown" }, { status: 502 }),
    });
    await expect(unknownClient.myRequests({})).rejects.toBeInstanceOf(ModelOperationError);
  });
});
