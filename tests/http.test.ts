import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ProcurementHttpClient } from "../generated/procurement/typescript/http-client.js";
import {
  createProcurementHttpHandler,
  type ProcurementDelegatedCapabilityClaim,
  type ProcurementDelegationIssueRequest,
  type ProcurementDelegationRuntime,
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
      catalogVersion: 5,
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

  it("returns an authenticated no-store current-state resource with explicit zero-age freshness", async () => {
    const retrievedAt = "2026-08-04T20:00:00.000Z";
    const data = [{
      id: purchaseRequest.id,
      createdAt: purchaseRequest.createdAt,
      amount: purchaseRequest.amount,
      status: purchaseRequest.status,
      approvedBy: null,
    }];
    const execute = vi.fn(async () => data);
    const handler = createProcurementHttpHandler(async () => ({ execute, assess }), {
      now: () => new Date(retrievedAt),
    });
    const responses: Response[] = [];
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "resource-token",
      fetch: async (input, init) => {
        const response = await handler(new Request(input, init));
        responses.push(response.clone());
        return response;
      },
    });
    const resource = await client.readMyRequestsResource({});

    expect(resource).toMatchObject({
      resourceVersion: 1,
      catalogVersion: 5,
      model: { id: "model:Procurement", version: "0.43.0" },
      operationId: "query:qry_4406b045404a48449282db804f6167a8",
      kind: "queryResult",
      authority: "none",
      view: {
        subjectSpecific: true,
        authorizationFiltered: true,
        containsCurrentState: true,
        containsInput: false,
        containsAuthenticatedIdentity: false,
        grantsAuthority: false,
      },
      freshness: {
        mode: "pointInTime",
        retrievedAt,
        maxAgeSeconds: 0,
        revalidate: "beforeReuse",
      },
      data,
    });
    expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(resource)).not.toMatch(/resource-token|requester|roles|query_audit/);
    expect(execute).toHaveBeenCalledWith(
      "query:qry_4406b045404a48449282db804f6167a8",
      {},
      {},
    );
    const schema = JSON.parse(await readFile("schemas/agent-resource.schema.json", "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } }).compile(schema);
    expect(validate(resource), JSON.stringify(validate.errors)).toBe(true);

    const metadata = await handler(new Request("https://example.test/agent/resources/queries/qry_4406b045404a48449282db804f6167a8", {
      method: "POST",
      headers: {
        authorization: "Bearer resource-token",
        "content-type": "application/json",
        "if-match": '"rev:1:0123456789abcdef0123456789abcdef"',
      },
      body: "{}",
    }));
    expect(metadata.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("assembles an authenticated bounded task packet without executing actions or disclosing request inputs", async () => {
    const assembledAt = "2026-08-05T13:00:00.000Z";
    const observationData = [{
      id: purchaseRequest.id,
      createdAt: purchaseRequest.createdAt,
      amount: purchaseRequest.amount,
      status: purchaseRequest.status,
      approvedBy: null,
    }];
    const execute = vi.fn(async (operationId: string) => {
      expect(operationId).toBe("query:qry_4406b045404a48449282db804f6167a8");
      return observationData;
    });
    const assessOperation = vi.fn(async () => applicableDecision);
    const handler = createProcurementHttpHandler(async () => ({ execute, assess: assessOperation }), {
      now: () => new Date(assembledAt),
    });
    const responses: Response[] = [];
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "task-packet-token",
      fetch: async (input, init) => {
        const response = await handler(new Request(input, init));
        responses.push(response.clone());
        return response;
      },
    });
    const packet = await client.taskPacket({
      actions: [{
        operationId: applicableDecision.operationId,
        input: { amount: { currency: "USD", amount: "987654.32" } },
        expectedRevision: applicableDecision.revision,
      }],
      observations: [{
        binding: "request-list",
        operationId: "query:qry_4406b045404a48449282db804f6167a8",
        input: {},
      }],
    });

    expect(packet).toMatchObject({
      packetVersion: 1,
      catalogVersion: 5,
      resourceVersion: 1,
      model: { id: "model:Procurement", version: "0.43.0" },
      kind: "boundedTaskContext",
      authority: "none",
      view: {
        subjectSpecific: true,
        authorizationFiltered: true,
        inputSpecific: true,
        containsCurrentState: true,
        containsOperationInput: false,
        containsObservationInput: false,
        containsRequestBindings: true,
        containsAuthenticatedIdentity: false,
        grantsAuthority: false,
        runtimeAuthorizationRequired: true,
      },
      freshness: { mode: "pointInTime", assembledAt, maxAgeSeconds: 0, revalidate: "beforeReuse" },
      snapshot: { atomic: false, observations: "independentReads" },
      closure: {
        status: "partial",
        dimensions: { applicability: "evaluated", observation: "callerSelected", recovery: "absent" },
        gaps: expect.arrayContaining(["taskGoalNotModeled", "recoveryNotPublished"]),
      },
      actions: [{
        operationId: applicableDecision.operationId,
        name: "openRequest",
        emittedEventIds: ["event:evt_10d694c9a0a274dc79c6168e47d25968"],
        applicability: applicableDecision,
      }],
      observations: [{
        binding: "request-list",
        operationId: "query:qry_4406b045404a48449282db804f6167a8",
        resource: {
          authority: "none",
          freshness: { retrievedAt: assembledAt, maxAgeSeconds: 0, revalidate: "beforeReuse" },
          data: observationData,
        },
      }],
    });
    expect(packet.packetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
    expect(assessOperation).toHaveBeenCalledWith(
      applicableDecision.operationId,
      { amount: { currency: "USD", amount: "987654.32" } },
      { expectedRevision: applicableDecision.revision },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "query:qry_4406b045404a48449282db804f6167a8",
      {},
      {},
    );
    expect(JSON.stringify(packet)).not.toMatch(/987654\.32|task-packet-token/);

    const schema = JSON.parse(await readFile("schemas/agent-task-packet.schema.json", "utf8"));
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      formats: { uuid: true, "date-time": true },
    }).compile(schema);
    expect(validate(packet), JSON.stringify(validate.errors)).toBe(true);

    const duplicate = await handler(new Request("https://example.test/agent/task-packets", {
      method: "POST",
      headers: { authorization: "Bearer task-packet-token", "content-type": "application/json" },
      body: JSON.stringify({
        actions: [
          { operationId: applicableDecision.operationId, input: { amount: { currency: "USD", amount: "1.00" } } },
          { operationId: applicableDecision.operationId, input: { amount: { currency: "USD", amount: "2.00" } } },
        ],
        observations: [],
      }),
    }));
    expect(duplicate.status).toBe(400);
    expect(assessOperation).toHaveBeenCalledTimes(1);

    const commandMetadata = await handler(new Request("https://example.test/agent/task-packets", {
      method: "POST",
      headers: {
        authorization: "Bearer task-packet-token",
        "content-type": "application/json",
        "if-match": `"${applicableDecision.revision}"`,
      },
      body: JSON.stringify({
        actions: [{ operationId: applicableDecision.operationId, input: { amount: { currency: "USD", amount: "1.00" } } }],
        observations: [],
      }),
    }));
    expect(commandMetadata.status).toBe(400);
    expect(assessOperation).toHaveBeenCalledTimes(1);
  });

  it("issues, invokes, expires, revokes, and consumes exact delegated action authority", async () => {
    const grantId = "10000000-0000-4000-8000-000000000001";
    const credential = "delegated-secret-that-is-at-least-thirty-two-bytes";
    const audience = "https://example.test";
    const delegatedInput = { amount: { currency: "USD", amount: "42.00" } } as const;
    let currentTime = new Date("2026-08-05T13:00:00.000Z");
    let issuedRequest: ProcurementDelegationIssueRequest | undefined;
    let claim: ProcurementDelegatedCapabilityClaim | undefined;
    let consumed = false;
    let revoked = false;
    const executeAsGrantor = vi.fn(async (
      _operationId: string,
      _input: Readonly<Record<string, unknown>>,
      _options?: Readonly<Record<string, unknown>>,
    ) => purchaseRequest);

    const grantorRuntime: ProcurementDelegationRuntime = {
      issue: vi.fn(async (request) => {
        issuedRequest = request;
        consumed = false;
        revoked = false;
        return { grantId, credential };
      }),
      revoke: vi.fn(async (candidate) => {
        expect(candidate).toBe(grantId);
        revoked = true;
        return { grantId, status: "revoked" as const, revoked: true };
      }),
      inspect: vi.fn(async () => null),
      invoke: vi.fn(async () => {
        throw new Error("grantors cannot invoke delegate credentials");
      }),
    };
    const delegateRuntime: ProcurementDelegationRuntime = {
      issue: vi.fn(async () => {
        throw new Error("delegates cannot issue grants");
      }),
      revoke: vi.fn(async () => ({ grantId, status: "notFound" as const, revoked: false })),
      inspect: vi.fn(async (candidate) => candidate === credential && !consumed && !revoked ? claim ?? null : null),
      invoke: vi.fn(async (candidate, inspected, operationId, input, options) => {
        if (candidate !== credential || inspected !== claim || consumed || revoked) {
          throw new AuthorizationError("delegation unavailable", "ML_DELEGATION_INVALID", "delegation:host");
        }
        consumed = true;
        return executeAsGrantor(operationId, input, options);
      }),
    };
    const handler = createProcurementHttpHandler(async (token) => {
      if (token === "grantor-token") return { executor: { execute: executeAsGrantor, assess }, delegation: grantorRuntime };
      if (token === "delegate-token") return { executor: { execute: vi.fn(), assess: vi.fn() }, delegation: delegateRuntime };
      return null;
    }, { now: () => currentTime, delegationAudience: audience });
    const grantor = new ProcurementHttpClient({
      baseUrl: audience,
      accessToken: () => "grantor-token",
      fetch: (input, init) => handler(new Request(input, init)),
    });

    const capability = await grantor.issueDelegatedCapability({
      action: { operationId: applicableDecision.operationId, input: delegatedInput },
      delegate: { issuer: "https://issuer.example", subject: "employee:42" },
      audience,
      expiresInSeconds: 60,
    });
    const { credential: deliveredCredential, view: _view, ...issuedClaim } = capability;
    claim = issuedClaim;
    expect(deliveredCredential).toEqual({
      scheme: "ModelLang-Delegation",
      secret: true,
      delivery: "once",
      value: credential,
    });
    expect(capability).toMatchObject({
      delegatedCapabilityVersion: 1,
      catalogVersion: 5,
      grantId,
      operationId: applicableDecision.operationId,
      authority: "delegated",
      revision: applicableDecision.revision,
      audience,
      constraints: {
        operation: "exact",
        input: "canonicalSha256",
        revision: "required",
        uses: 1,
        transferable: false,
        redelegation: false,
      },
      view: {
        containsOperationInput: false,
        containsGrantorIdentity: false,
        containsDelegateIdentity: false,
        containsCredential: true,
        grantsAuthority: true,
        runtimeAuthorizationRequired: true,
      },
    });
    expect(issuedRequest).toMatchObject({
      action: { operationId: applicableDecision.operationId, input: delegatedInput },
      delegate: { issuer: "https://issuer.example", subject: "employee:42" },
      audience,
      revision: applicableDecision.revision,
    });
    expect(issuedRequest!.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(capability)).not.toMatch(/employee:42|issuer\.example|42\.00|grantor-token|delegate-token/);
    const delegatedSchema = JSON.parse(await readFile("schemas/delegated-capability.schema.json", "utf8"));
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      formats: { uuid: true, uri: true },
    }).compile(delegatedSchema);
    expect(validate(capability), JSON.stringify(validate.errors)).toBe(true);

    const delegate = new ProcurementHttpClient({
      baseUrl: audience,
      accessToken: () => "delegate-token",
      headers: { "delegated-capability": credential },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const wrongDelegate = new ProcurementHttpClient({
      baseUrl: audience,
      accessToken: () => "grantor-token",
      headers: { "delegated-capability": credential },
      fetch: (input, init) => handler(new Request(input, init)),
    });
    await expect(wrongDelegate.openRequest(delegatedInput)).rejects.toBeInstanceOf(AuthorizationError);
    const correctClaim = claim;
    claim = { ...correctClaim, audience: "https://wrong-audience.example" };
    await expect(delegate.openRequest(delegatedInput)).rejects.toBeInstanceOf(AuthorizationError);
    claim = correctClaim;
    await expect(delegate.openRequest(
      { amount: { currency: "USD", amount: "43.00" } },
    )).rejects.toBeInstanceOf(AuthorizationError);
    expect(delegateRuntime.invoke).not.toHaveBeenCalled();
    await expect(delegate.myRequests({})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(delegate.openRequest(delegatedInput, { idempotencyKey: "caller-metadata" }))
      .rejects.toBeInstanceOf(ValidationError);

    await expect(delegate.openRequest(delegatedInput)).resolves.toEqual(purchaseRequest);
    expect(executeAsGrantor).toHaveBeenCalledWith(
      applicableDecision.operationId,
      delegatedInput,
      {
        expectedRevision: applicableDecision.revision,
        idempotencyKey: `delegation-${grantId}`,
        correlationId: `delegation-${grantId}`,
      },
    );
    await expect(delegate.openRequest(delegatedInput)).rejects.toBeInstanceOf(AuthorizationError);
    expect(delegateRuntime.invoke).toHaveBeenCalledTimes(1);

    const revokedCapability = await grantor.issueDelegatedCapability({
      action: { operationId: applicableDecision.operationId, input: delegatedInput },
      delegate: { issuer: "https://issuer.example", subject: "employee:42" },
      audience,
      expiresInSeconds: 60,
    });
    const { credential: _revokedCredential, view: _revokedView, ...revokedClaim } = revokedCapability;
    claim = revokedClaim;
    await expect(grantor.revokeDelegatedCapability(grantId)).resolves.toEqual({ grantId, status: "revoked", revoked: true });
    await expect(delegate.openRequest(delegatedInput)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(delegate.issueDelegatedCapability({
      action: { operationId: applicableDecision.operationId, input: delegatedInput },
      delegate: { issuer: "https://issuer.example", subject: "employee:99" },
      audience,
      expiresInSeconds: 60,
    })).rejects.toBeInstanceOf(AuthorizationError);

    const expiringCapability = await grantor.issueDelegatedCapability({
      action: { operationId: applicableDecision.operationId, input: delegatedInput },
      delegate: { issuer: "https://issuer.example", subject: "employee:42" },
      audience,
      expiresInSeconds: 1,
    });
    const { credential: _expiringCredential, view: _expiringView, ...expiringClaim } = expiringCapability;
    claim = expiringClaim;
    currentTime = new Date(currentTime.getTime() + 1_000);
    await expect(delegate.openRequest(delegatedInput)).rejects.toBeInstanceOf(AuthorizationError);
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
