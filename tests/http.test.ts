import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
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
import {
  createReservationsHttpHandler,
  type ReservationsOperationExecutor,
} from "../generated/reservations/typescript/http-server.js";

const openRoute = "https://example.test/operations/actions/act_1e35db0451b1461e941af6283d86dca2";
const purchaseRequest = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: "2026-07-30T12:00:00Z",
  requester: "00000000-0000-4000-8000-000000000001",
  amount: { currency: "USD", amount: "10.00" },
  status: "DRAFT",
  approvedBy: null,
  approvedByRoles: null,
  approvalObserved: false,
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
  it("accepts null-redacted projection fields while retaining closed output validation", async () => {
    const route = "https://example.test/operations/queries/qry_4406b045404a48449282db804f6167a8";
    const summary = {
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-07-30T12:00:00Z",
      amount: null,
      status: "DRAFT",
      approvedBy: null,
    };
    const handler = createProcurementHttpHandler(async () => ({
      execute: async () => [summary],
      assess,
    }));
    const response = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([summary]);

    const malformed = createProcurementHttpHandler(async () => ({
      execute: async () => [{ ...summary, amount: "redacted" }],
      assess,
    }));
    const malformedResponse = await malformed(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: "{}",
    }));
    expect(malformedResponse.status).toBe(500);
  });

  it("validates closed cursor-page inputs and outputs", async () => {
    const route = "https://example.test/operations/queries/qry_94d8a56f4c2640fab58a4c2190c35c69";
    const cursor = "eyJ2IjoxfQ";
    const page = {
      items: [{
        id: "00000000-0000-4000-8000-000000000020",
        resource: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Conference Room A",
        },
        startsAt: "2031-01-10T10:00:00Z",
        endsAt: "2031-01-10T11:00:00Z",
      }],
      nextCursor: cursor,
    };
    const execute = vi.fn(async () => page);
    const executor = {
      execute,
      assess: async () => ({
        operationId: "action:act_508ad810a19d4b79a5009871de5cd26b",
        status: "denied",
        applicable: false,
        authority: "none",
        explanation: { kind: "authorization", ruleId: "authorize:action:act_508ad810a19d4b79a5009871de5cd26b" },
      }),
    } satisfies ReservationsOperationExecutor;
    const handler = createReservationsHttpHandler(async () => executor);
    const response = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ resource: "20000000-0000-4000-8000-000000000001", cursor }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(execute).toHaveBeenCalledWith(
      "query:qry_94d8a56f4c2640fab58a4c2190c35c69",
      { resource: "20000000-0000-4000-8000-000000000001", cursor },
      { expectedRevision: undefined },
    );

    const explicitNull = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({
        resource: "20000000-0000-4000-8000-000000000001",
        startsAtOrAfter: null,
      }),
    }));
    expect(explicitNull.status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(
      "query:qry_94d8a56f4c2640fab58a4c2190c35c69",
      { resource: "20000000-0000-4000-8000-000000000001", startsAtOrAfter: null },
      { expectedRevision: undefined },
    );

    const authoredSort = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({
        resource: "20000000-0000-4000-8000-000000000001",
        sort: "latestFirst",
      }),
    }));
    expect(authoredSort.status).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(
      "query:qry_94d8a56f4c2640fab58a4c2190c35c69",
      { resource: "20000000-0000-4000-8000-000000000001", sort: "latestFirst" },
      { expectedRevision: undefined },
    );

    const invalidSort = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({
        resource: "20000000-0000-4000-8000-000000000001",
        sort: "arbitraryField desc",
      }),
    }));
    expect(invalidSort.status).toBe(400);
    expect(await invalidSort.json()).toMatchObject({
      ruleId: "sort-profile:query:qry_94d8a56f4c2640fab58a4c2190c35c69",
    });

    const invalidFilter = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({
        resource: "20000000-0000-4000-8000-000000000001",
        startsAtOrAfter: "tomorrow",
      }),
    }));
    expect(invalidFilter.status).toBe(400);

    const malformed = await handler(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ resource: "20000000-0000-4000-8000-000000000001", cursor: "not base64url!" }),
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ ruleId: "cursor:query:qry_94d8a56f4c2640fab58a4c2190c35c69" });

    const invalidOutput = createReservationsHttpHandler(async () => ({
      ...executor,
      execute: async () => page.items,
    }));
    const invalid = await invalidOutput(new Request(route, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: JSON.stringify({ resource: "20000000-0000-4000-8000-000000000001" }),
    }));
    expect(invalid.status).toBe(500);
  });

  it("recursively validates closed nested query projections", async () => {
    const queryRoute = "https://example.test/operations/queries/qry_4406b045404a48449282db804f6167a8";
    const validResult = [{
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-07-30T12:00:00Z",
      amount: { currency: "USD", amount: "10.00" },
      status: "APPROVED",
      approvedBy: {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Manager",
      },
    }];
    const queryRequest = () => new Request(queryRoute, {
      method: "POST",
      headers: { authorization: "Bearer valid", "content-type": "application/json" },
      body: "{}",
    });
    const validHandler = createProcurementHttpHandler(async () => ({
      execute: async () => validResult,
      assess,
    }));
    const valid = await validHandler(queryRequest());
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual(validResult);

    const invalidHandler = createProcurementHttpHandler(async () => ({
      execute: async () => [{ ...validResult[0], approvedBy: "00000000-0000-4000-8000-000000000003" }],
      assess,
    }));
    const invalid = await invalidHandler(queryRequest());
    expect(invalid.status).toBe(500);
    expect(JSON.stringify(await invalid.json())).not.toContain("00000000-0000-4000-8000-000000000003");
  });

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

  it("returns an authenticated input-specific action capability view without identity or state payloads", async () => {
    const submitId = "action:act_ed2374e822704c51a2925338253d05d2" as const;
    const execute = vi.fn(async () => purchaseRequest);
    const assessOperation = vi.fn(async (operationId: string) => operationId === applicableDecision.operationId
      ? applicableDecision
      : {
          operationId: submitId,
          status: "denied" as const,
          applicable: false,
          authority: "none" as const,
          explanation: { kind: "authorization" as const, ruleId: `authorize:${submitId}` },
        });
    const handler = createProcurementHttpHandler(async () => ({
      execute,
      assess: assessOperation,
    }));
    const requests: Request[] = [];
    const responses: Response[] = [];
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "subject-token",
      fetch: async (input, init) => {
        const incoming = new Request(input, init);
        requests.push(incoming.clone());
        const response = await handler(incoming);
        responses.push(response.clone());
        return response;
      },
    });
    const view = await client.subjectCapabilities([
      {
        operationId: applicableDecision.operationId,
        input: { amount: { currency: "USD", amount: "10.00" } },
        expectedRevision: applicableDecision.revision,
      },
      {
        operationId: submitId,
        input: { request: purchaseRequest.id },
      },
    ]);

    expect(requests[0]!.url).toBe("https://example.test/agent/capabilities");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer subject-token");
    expect(requests[0]!.headers.get("if-match")).toBeNull();
    expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
    expect(view).toMatchObject({
      viewVersion: 1,
      catalogVersion: 2,
      model: { id: "model:Procurement" },
      view: {
        subjectSpecific: true,
        authorizationFiltered: true,
        inputSpecific: true,
        containsResourceState: false,
        grantsAuthority: false,
        runtimeAuthorizationRequired: true,
      },
      authentication: { callerInput: false, identityDisclosed: false },
      available: [{
        operationId: applicableDecision.operationId,
        status: "applicable",
        applicable: true,
        authority: "none",
        revision: applicableDecision.revision,
      }],
      unavailable: [{
        operationId: submitId,
        status: "denied",
        applicable: false,
        authority: "none",
        explanation: { kind: "authorization", ruleId: `authorize:${submitId}` },
      }],
    });
    expect(JSON.stringify(view)).not.toMatch(/subject-token|00000000-0000-4000-8000-000000000010|amount|requester|roles/);
    expect(assessOperation).toHaveBeenNthCalledWith(
      1,
      applicableDecision.operationId,
      { amount: { currency: "USD", amount: "10.00" } },
      { expectedRevision: applicableDecision.revision },
    );
    const schema = JSON.parse(await readFile("schemas/subject-capability-view.schema.json", "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(view), JSON.stringify(validate.errors)).toBe(true);

    const invalid = await handler(new Request("https://example.test/agent/capabilities", {
      method: "POST",
      headers: { authorization: "Bearer subject-token", "content-type": "application/json" },
      body: JSON.stringify({
        candidates: [{ operationId: "query:qry_4406b045404a48449282db804f6167a8", input: {} }],
      }),
    }));
    expect(invalid.status).toBe(400);
    expect(assessOperation).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();

    const duplicate = await handler(new Request("https://example.test/agent/capabilities", {
      method: "POST",
      headers: { authorization: "Bearer subject-token", "content-type": "application/json" },
      body: JSON.stringify({ candidates: [
        { operationId: submitId, input: { request: purchaseRequest.id } },
        { operationId: submitId, input: { request: purchaseRequest.id } },
      ] }),
    }));
    expect(duplicate.status).toBe(400);
    expect(assessOperation).toHaveBeenCalledTimes(2);

    const unauthenticated = await handler(new Request("https://example.test/agent/capabilities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidates: [] }),
    }));
    expect(unauthenticated.status).toBe(401);
    expect(assessOperation).toHaveBeenCalledTimes(2);
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
