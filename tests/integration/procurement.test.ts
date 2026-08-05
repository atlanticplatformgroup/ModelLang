import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProcurementClient } from "../../generated/procurement/typescript/client.js";
import { ProcurementHttpClient } from "../../generated/procurement/typescript/http-client.js";
import {
  createProcurementHttpHandler,
  type ProcurementAuthenticator,
} from "../../generated/procurement/typescript/http-server.js";
import { createProcurementGatewayExecutor } from "../../generated/procurement/typescript/gateway.js";
import { createProcurementMcpHandler } from "../../generated/procurement/typescript/mcp-server.js";
import { consumeObserveRequestApproval, deliverObserveRequestApproval, recoverObserveRequestApproval } from "../../generated/procurement/typescript/consumers.js";
import type { RequestApprovedEvent } from "../../generated/procurement/typescript/events.js";
import {
  acknowledgeProcurementEvent,
  claimProcurementEvents,
  failProcurementEvent,
  releaseProcurementEvent,
} from "../../generated/procurement/typescript/dispatcher.js";
import { recoverProcurementEventPublication } from "../../generated/procurement/typescript/publication-recovery.js";
import {
  observeProcurementTerminalConsumers,
  observeProcurementTerminalPublications,
  type ConsumerFailureCursor,
} from "../../generated/procurement/typescript/failure-observer.js";
import {
  acknowledgeProcurementTerminalConsumer,
  acknowledgeProcurementTerminalPublication,
} from "../../generated/procurement/typescript/failure-acknowledgement.js";
import {
  claimProcurementTerminalConsumer,
  claimProcurementTerminalPublication,
} from "../../generated/procurement/typescript/failure-claim.js";
import {
  createProcurementUiExecutor,
  createProcurementUiWorkflowExecutor,
  ProcurementUiManifest,
} from "../../generated/procurement/typescript/ui.js";
import {
  AuthenticationError, AuthorizationError, IdempotencyConflictError, IdentityBindingError, PreconditionError,
  StaleError, ValidationError,
} from "../../generated/procurement/typescript/errors.js";
import {
  databaseUrl, installDemoDatabase, loginUrl, poolFor,
} from "../../scripts/database.js";

const pools: Pool[] = [];
const clients = {
  employeeOne: undefined as unknown as ProcurementClient,
  employeeTwo: undefined as unknown as ProcurementClient,
  manager: undefined as unknown as ProcurementClient,
  finance: undefined as unknown as ProcurementClient,
  unbound: undefined as unknown as ProcurementClient,
};
let admin: Pool;
let gateway: Pool;
let consumer: Pool;
let recovery: Pool;
let publicationRecovery: Pool;
let failureObserver: Pool;
let failureAcknowledger: Pool;
let failureClaimant: Pool;

function usd(amount: string): { currency: "USD"; amount: string } {
  return { currency: "USD", amount };
}

let commandSequence = 0;
function commandOptions(label = "test"): { idempotencyKey: string } {
  commandSequence += 1;
  return { idempotencyKey: `${label}-${commandSequence}` };
}

async function withHttpServer(
  authenticate: ProcurementAuthenticator,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const handler = createProcurementHttpHandler(authenticate);
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
        method: incoming.method,
        headers,
        ...(body ? { body } : {}),
      });
      const response = await handler(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

beforeAll(async () => {
  await installDemoDatabase();
  const employeeOne = poolFor("ml_employee_one");
  const employeeTwo = poolFor("ml_employee_two");
  const manager = poolFor("ml_manager");
  const finance = poolFor("ml_finance");
  const unbound = poolFor("ml_unbound");
  gateway = new Pool({ connectionString: loginUrl("ml_gateway"), max: 1 });
  consumer = poolFor("ml_consumer");
  recovery = poolFor("ml_recovery");
  publicationRecovery = poolFor("ml_publication_recovery");
  failureObserver = poolFor("ml_failure_observer");
  failureAcknowledger = poolFor("ml_failure_acknowledger");
  failureClaimant = poolFor("ml_failure_claimant");
  pools.push(employeeOne, employeeTwo, manager, finance, unbound, gateway, consumer, recovery, publicationRecovery, failureObserver, failureAcknowledger, failureClaimant);
  clients.employeeOne = new ProcurementClient(employeeOne);
  clients.employeeTwo = new ProcurementClient(employeeTwo);
  clients.manager = new ProcurementClient(manager);
  clients.finance = new ProcurementClient(finance);
  clients.unbound = new ProcurementClient(unbound);
  admin = new Pool({ connectionString: databaseUrl });
}, 30_000);

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  if (admin) await admin.end();
});

async function submittedRequest(amount: string): Promise<string> {
  const opened = await clients.employeeOne.openRequest({ amount: usd(amount) }, commandOptions("submitted"));
  await clients.employeeOne.submitRequest({ request: opened.id });
  return opened.id;
}

const recoverableConsumerId = "consumer:con_10d694c9a0a274dc79c6168e47d25968";

function terminalFailureFixtures(dispatcher: Pool): {
  terminalConsumer: (eventId: string, firstAttempt?: number) => Promise<void>;
  terminalPublication: (targetId: string) => Promise<string>;
} {
  return {
    async terminalConsumer(eventId: string, firstAttempt = 1): Promise<void> {
      for (let attempt = firstAttempt; attempt < firstAttempt + 3; attempt += 1) {
        await consumer.query(
          "SELECT model_procurement_internal.record_consumer_failure($1, $2, $3, $4)",
          [recoverableConsumerId, eventId, attempt, "ML_HANDLER_UNAVAILABLE"],
        );
      }
    },
    async terminalPublication(targetId: string): Promise<string> {
      let eventInstanceId = "";
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claimedEvents = await claimProcurementEvents(dispatcher, 1000, 60);
        const target = claimedEvents.find((event) => event.targetId === targetId)!;
        expect(target).toBeTruthy();
        eventInstanceId = target.id;
        for (const event of claimedEvents) {
          if (event.id !== target.id) await releaseProcurementEvent(dispatcher, event.id, event.leaseToken);
        }
        await failProcurementEvent(dispatcher, target.id, target.leaseToken, "ML_BROKER_UNAVAILABLE");
      }
      return eventInstanceId;
    },
  };
}

async function requestApprovedEnvelope(request: string): Promise<RequestApprovedEvent> {
  const result = await admin.query<{ envelope: RequestApprovedEvent }>(`
    SELECT pg_catalog.jsonb_build_object(
      'id', id, 'eventId', event_id, 'eventName', event_name, 'modelId', model_id,
      'modelVersion', model_version, 'sourceHash', source_hash, 'actionId', action_id,
      'consumerId', consumer_id, 'targetId', target_id, 'payload', payload,
      'correlationId', correlation_id, 'causationId', causation_id, 'occurredAt', occurred_at,
      'ordinal', ordinal, 'deliveryAttempt', 1
    ) AS envelope
    FROM model_procurement_internal.event_outbox
    WHERE target_id = $1 AND event_id = 'event:evt_30d694c9a0a274dc79c6168e47d25968'
  `, [request]);
  return result.rows[0]!.envelope;
}

async function waitUntilLockWaiting(pids: number[], timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ pid: number }>(
      `SELECT pid FROM pg_catalog.pg_stat_activity
       WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'`,
      [pids],
    );
    if (new Set(result.rows.map((row) => row.pid)).size === pids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Backends ${pids.join(", ")} did not enter an observed PostgreSQL lock wait`);
}

describe.sequential("PostgreSQL enforcement boundary", () => {
  it("allows the procurement workflow and rejects invalid actors and transitions", async () => {
    await expect(clients.employeeOne.openRequest({ amount: usd("0") }, commandOptions())).rejects.toBeInstanceOf(PreconditionError);
    const opened = await clients.employeeOne.openRequest({ amount: usd("5000") }, commandOptions());
    const low = opened.id;
    expect(opened).toMatchObject({
      requester: "00000000-0000-4000-8000-000000000001",
      amount: { currency: "USD", amount: "5000.00" },
      status: "DRAFT",
      approvedBy: null,
    });
    expect(opened.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(opened.createdAt))).toBe(false);
    const redactedDraft = (await clients.employeeOne.myRequests({})).find((request) => request.id === low)!;
    expect(Object.hasOwn(redactedDraft, "amount")).toBe(true);
    expect(redactedDraft.amount).toBeNull();
    await expect(clients.employeeTwo.submitRequest({ request: low })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await clients.employeeOne.submitRequest({ request: low })).status).toBe("SUBMITTED");
    expect((await clients.employeeOne.myRequests({})).find((request) => request.id === low)?.amount)
      .toEqual({ currency: "USD", amount: "5000.00" });
    const approvedLow = await clients.manager.approveRequest({ request: low });
    expect(approvedLow).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000003",
      approvedByRoles: ["EMPLOYEE", "MANAGER"],
    });
    const disclosedLow = (await clients.employeeOne.myRequests({})).find((request) => request.id === low)!;
    expect(disclosedLow.approvedBy).toEqual({
      id: "00000000-0000-4000-8000-000000000003",
      name: "Manager",
    });
    expect(Object.hasOwn(disclosedLow.approvedBy!, "roles")).toBe(false);

    const high = await submittedRequest("25000");
    await expect(clients.manager.approveRequest({ request: high })).rejects.toBeInstanceOf(AuthorizationError);
    const approvedHigh = await clients.finance.approveRequest({ request: high });
    expect(approvedHigh).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000004",
      approvedByRoles: ["EMPLOYEE", "FINANCE"],
    });

    const evidence = await admin.query<{
      target_id: string;
      model_id: string;
      model_version: string;
      authorization_rule_id: string;
      policy_id: string;
      authority_id: string;
      decision_outcome: string;
      decision_evidence: { outcome: string; authorization: { authorityId: string } };
    }>(
      `SELECT target_id, model_id, model_version, authorization_rule_id, policy_id,
              authority_id, decision_outcome, decision_evidence
       FROM model_procurement_internal.action_audit
       WHERE action_id = 'action:act_d39dbb883b5f4019b9027b85add3de47'
         AND target_id = ANY($1::uuid[])
       ORDER BY target_id`,
      [[low, high]],
    );
    const byTarget = new Map(evidence.rows.map((row) => [row.target_id, row]));
    expect(byTarget.get(low)).toMatchObject({
      model_id: "model:Procurement",
      model_version: "0.41.0",
      authorization_rule_id: "authorize:action:act_d39dbb883b5f4019b9027b85add3de47",
      policy_id: "policy:pol_a3a80ffeec774402be92cddaafd0f069",
      authority_id: "policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688",
      decision_outcome: "executed",
      decision_evidence: {
        outcome: "executed",
        authorization: { authorityId: "policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688" },
      },
    });
    expect(byTarget.get(high)).toMatchObject({
      policy_id: "policy:pol_a3a80ffeec774402be92cddaafd0f069",
      authority_id: "policyBranch:pbr_6b38447b5bf944769d1d737c069c7420",
      decision_evidence: {
        authorization: { authorityId: "policyBranch:pbr_6b38447b5bf944769d1d737c069c7420" },
      },
    });

    const managerRequest = await clients.manager.openRequest({ amount: usd("25") }, commandOptions());
    expect(managerRequest).toMatchObject({
      requester: "00000000-0000-4000-8000-000000000003",
    });
    expect((await clients.manager.myRequests({})).some((request) => request.id === managerRequest.id)).toBe(true);
  });

  it("records private hash-bound evidence only for committed successful opted-in reads", async () => {
    const queryId = "query:qry_4406b045404a48449282db804f6167a8";
    const descriptor = ProcurementUiManifest.queries.find((query) => query.name === "myRequests")!;
    const before = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM model_procurement_internal.query_audit WHERE query_id = $1",
      [queryId],
    );
    const result = await clients.employeeOne.myRequests({});
    const evidence = await admin.query<{
      query_id: string;
      database_principal: string;
      principal_id: string;
      identity_issuer: string | null;
      identity_subject: string | null;
      model_id: string;
      model_version: string;
      source_hash: string;
      query_revision: string;
      request_hash: string;
      response_hash: string;
      result_count: number;
      sort_profile: string;
      continued: boolean;
    }>(`
      SELECT query_id, database_principal, principal_id, identity_issuer, identity_subject,
             model_id, model_version, source_hash, query_revision, request_hash,
             response_hash, result_count, sort_profile, continued
      FROM model_procurement_internal.query_audit
      WHERE query_id = $1
      ORDER BY id DESC
      LIMIT 1
    `, [queryId]);
    expect(Number(before.rows[0]!.count) + 1).toBeGreaterThan(0);
    expect(evidence.rows[0]).toMatchObject({
      query_id: queryId,
      database_principal: "ml_employee_one",
      principal_id: "00000000-0000-4000-8000-000000000001",
      identity_issuer: null,
      identity_subject: null,
      model_id: "model:Procurement",
      model_version: "0.41.0",
      source_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      query_revision: descriptor.readEvidence!.revision,
      request_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      response_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      result_count: result.length,
      sort_profile: "default",
      continued: false,
    });
    const hashes = await admin.query<{ request_hash: string; response_hash: string }>(`
      SELECT
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(($1::jsonb)::text, 'UTF8')), 'hex') AS request_hash,
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(($2::jsonb)::text, 'UTF8')), 'hex') AS response_hash
    `, [JSON.stringify({ queryId, revision: descriptor.readEvidence!.revision, inputs: {}, sortProfile: "default" }), JSON.stringify(result)]);
    expect(evidence.rows[0]).toMatchObject(hashes.rows[0]!);

    const direct = new Client({ connectionString: loginUrl("ml_employee_one") });
    await direct.connect();
    try {
      await expect(direct.query("SELECT * FROM model_procurement_internal.query_audit")).rejects.toMatchObject({ code: "42501" });
      await direct.query("BEGIN");
      await direct.query("SELECT model_procurement.my_requests()");
      await direct.query("ROLLBACK");
    } finally {
      await direct.end();
    }
    const afterRollback = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM model_procurement_internal.query_audit WHERE query_id = $1",
      [queryId],
    );
    expect(afterRollback.rows[0]!.count).toBe(String(Number(before.rows[0]!.count) + 1));

    await expect(clients.unbound.myRequests({})).rejects.toBeInstanceOf(IdentityBindingError);
    const afterDenied = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM model_procurement_internal.query_audit WHERE query_id = $1",
      [queryId],
    );
    expect(afterDenied.rows[0]!.count).toBe(afterRollback.rows[0]!.count);
  });

  it("replays reliable commands exactly once and keeps receipts private and linked", async () => {
    const idempotencyKey = `replay-${randomUUID()}`;
    const options = {
      idempotencyKey,
      correlationId: `correlation-${randomUUID()}`,
      causationId: `causation-${randomUUID()}`,
    };
    const first = await clients.employeeOne.openRequest({ amount: usd("41") }, options);
    const replay = await clients.employeeOne.openRequest({ amount: usd("41.00") }, options);
    expect(replay).toEqual(first);

    const receipt = await admin.query<{
      status: string;
      response: unknown;
      target_id: string;
      correlation_id: string;
      causation_id: string;
      action_audit_id: string;
      audit_receipt_id: string;
      evidence_receipt_id: string;
    }>(`
      SELECT receipt.status, receipt.response, receipt.target_id, receipt.correlation_id,
             receipt.causation_id, receipt.action_audit_id::text,
             audit.command_receipt_id::text AS audit_receipt_id,
             audit.decision_evidence->'command'->>'receiptId' AS evidence_receipt_id
      FROM model_procurement_internal.command_receipt AS receipt
      JOIN model_procurement_internal.action_audit AS audit ON audit.id = receipt.action_audit_id
      WHERE receipt.principal_id = '00000000-0000-4000-8000-000000000001'
        AND receipt.action_id = 'action:act_1e35db0451b1461e941af6283d86dca2'
        AND receipt.idempotency_key = $1
    `, [idempotencyKey]);
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]).toMatchObject({
      status: "executed",
      response: first,
      target_id: first.id,
      correlation_id: options.correlationId,
      causation_id: options.causationId,
      audit_receipt_id: receipt.rows[0]!.evidence_receipt_id,
    });
    expect(receipt.rows[0]!.action_audit_id).toBeTruthy();
    const events = await admin.query<{ count: string; event_id: string; payload: { id: string } }>(`
      SELECT count(*) OVER ()::text AS count, event_id, payload
      FROM model_procurement_internal.event_outbox WHERE target_id = $1
    `, [first.id]);
    expect(events.rows).toEqual([expect.objectContaining({
      count: "1",
      event_id: "event:evt_10d694c9a0a274dc79c6168e47d25968",
      payload: expect.objectContaining({ id: first.id }),
    })]);
  });

  it("redelivers expired leases and acknowledges private events through the execute-only dispatcher boundary", async () => {
    const created = await clients.employeeOne.openRequest({ amount: usd("42") }, commandOptions("outbox"));
    const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await dispatcher.connect();
    try {
      await expect(dispatcher.query("SELECT * FROM model_procurement_internal.event_outbox"))
        .rejects.toMatchObject({ code: "42501" });
      const claimed = await dispatcher.query<{ claim_events: {
        id: string; targetId: string; eventId: string; leaseToken: string; deliveryAttempt: number;
      } }>("SELECT model_procurement_internal.claim_events(1000, 60)");
      const target = claimed.rows.map((row) => row.claim_events).find((event) => event.targetId === created.id)!;
      expect(target).toMatchObject({
        targetId: created.id,
        eventId: "event:evt_10d694c9a0a274dc79c6168e47d25968",
        deliveryAttempt: 1,
      });
      for (const event of claimed.rows.map((row) => row.claim_events)) {
        if (event.id !== target.id) {
          await dispatcher.query("SELECT model_procurement_internal.release_event($1, $2)", [event.id, event.leaseToken]);
        }
      }
      await admin.query(
        "UPDATE model_procurement_internal.event_outbox SET leased_until = clock_timestamp() - interval '1 second' WHERE id = $1",
        [target.id],
      );
      const reclaimed = await dispatcher.query<typeof claimed.rows[number]>(
        "SELECT model_procurement_internal.claim_events(1000, 60)",
      );
      const redelivery = reclaimed.rows.map((row) => row.claim_events).find((event) => event.id === target.id)!;
      expect(redelivery).toMatchObject({ id: target.id, deliveryAttempt: 2 });
      expect(redelivery.leaseToken).not.toBe(target.leaseToken);
      for (const event of reclaimed.rows.map((row) => row.claim_events)) {
        if (event.id === redelivery.id) {
          await dispatcher.query("SELECT model_procurement_internal.ack_event($1, $2)", [event.id, event.leaseToken]);
        } else {
          await dispatcher.query("SELECT model_procurement_internal.release_event($1, $2)", [event.id, event.leaseToken]);
        }
      }
      const stored = await admin.query<{ published: boolean }>(
        "SELECT published_at IS NOT NULL AS published FROM model_procurement_internal.event_outbox WHERE id = $1",
        [target.id],
      );
      expect(stored.rows[0]!.published).toBe(true);
    } finally {
      await dispatcher.end();
    }
  });

  it("records bounded publication failures and stops claiming terminal outbox events", async () => {
    const created = await clients.employeeOne.openRequest({ amount: usd("43") }, commandOptions("publication-failure"));
    const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await dispatcher.connect();
    try {
      let targetId = "";
      for (let failureCount = 1; failureCount <= 5; failureCount += 1) {
        const claimed = await claimProcurementEvents(dispatcher, 1000, 60);
        const target = claimed.find((event) => event.targetId === created.id)!;
        expect(target).toBeTruthy();
        targetId = target.id;
        for (const event of claimed) {
          if (event.id !== target.id) await releaseProcurementEvent(dispatcher, event.id, event.leaseToken);
        }
        const outcome = await failProcurementEvent(dispatcher, target.id, target.leaseToken, "ML_BROKER_UNAVAILABLE");
        expect(outcome).toEqual({
          status: failureCount === 5 ? "deadLetter" : "retry",
          recorded: true,
          failureCount,
          maxAttempts: 5,
        });
      }

      const terminal = await admin.query<{
        publication_failure_count: number;
        publication_max_attempts: number;
        publication_disposition: string;
        last_publication_error_code: string;
        leased: boolean;
        terminal: boolean;
      }>(`
        SELECT publication_failure_count, publication_max_attempts, publication_disposition,
               last_publication_error_code, lease_token IS NOT NULL AS leased,
               publication_terminal_at IS NOT NULL AS terminal
        FROM model_procurement_internal.event_outbox WHERE id = $1
      `, [targetId]);
      expect(terminal.rows[0]).toEqual({
        publication_failure_count: 5,
        publication_max_attempts: 5,
        publication_disposition: "deadLetter",
        last_publication_error_code: "ML_BROKER_UNAVAILABLE",
        leased: false,
        terminal: true,
      });

      const later = await claimProcurementEvents(dispatcher, 1000, 60);
      expect(later.some((event) => event.id === targetId)).toBe(false);
      for (const event of later) await releaseProcurementEvent(dispatcher, event.id, event.leaseToken);
      await expect(failProcurementEvent(consumer, targetId, randomUUID(), "ML_FORGED"))
        .rejects.toMatchObject({ code: "42501" });
    } finally {
      await dispatcher.end();
    }
  });

  it("recovers terminal publication failures under isolated audited authority", async () => {
    const created = await clients.employeeOne.openRequest({ amount: usd("45") }, commandOptions("publication-recovery"));
    const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await dispatcher.connect();
    const claimTarget = async () => {
      const claimed = await claimProcurementEvents(dispatcher, 1000, 60);
      const target = claimed.find((event) => event.targetId === created.id)!;
      expect(target).toBeTruthy();
      for (const event of claimed) {
        if (event.id !== target.id) await releaseProcurementEvent(dispatcher, event.id, event.leaseToken);
      }
      return target;
    };
    try {
      let targetId = "";
      for (let count = 1; count <= 5; count += 1) {
        const target = await claimTarget();
        targetId = target.id;
        await failProcurementEvent(dispatcher, target.id, target.leaseToken, "ML_BROKER_UNAVAILABLE");
      }

      await expect(recoverProcurementEventPublication(dispatcher, targetId, "OPERATOR_REVIEWED"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(recoverProcurementEventPublication(recovery, targetId, "WRONG_RECOVERY_ROLE"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(admin.query("SELECT model_procurement_internal.recover_event_publication($1, $2)", [targetId, "OWNER_ATTEMPT"]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(publicationRecovery.query("SELECT * FROM model_procurement_internal.event_outbox"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(claimProcurementEvents(publicationRecovery, 1, 60))
        .rejects.toMatchObject({ code: "42501" });

      await expect(recoverProcurementEventPublication(publicationRecovery, targetId, "OPERATOR_REVIEWED")).resolves.toEqual({
        status: "recovered",
        recoveryGeneration: 1,
        priorFailureCount: 5,
        totalFailureCount: 5,
      });
      const firstRecovery = await admin.query<{
        publication_failure_count: number;
        publication_total_failure_count: number;
        publication_disposition: string;
        publication_recovery_generation: number;
      }>(`SELECT publication_failure_count, publication_total_failure_count, publication_disposition, publication_recovery_generation
          FROM model_procurement_internal.event_outbox WHERE id = $1`, [targetId]);
      expect(firstRecovery.rows[0]).toEqual({
        publication_failure_count: 0,
        publication_total_failure_count: 5,
        publication_disposition: "pending",
        publication_recovery_generation: 1,
      });
      const firstAudit = await admin.query<{ reason_code: string; database_principal: string; prior_error_code: string }>(
        `SELECT reason_code, database_principal::text, prior_error_code
         FROM model_procurement_internal.publication_recovery_audit WHERE event_outbox_id = $1`,
        [targetId],
      );
      expect(firstAudit.rows).toEqual([{
        reason_code: "OPERATOR_REVIEWED",
        database_principal: "ml_publication_recovery",
        prior_error_code: "ML_BROKER_UNAVAILABLE",
      }]);

      for (let count = 1; count <= 5; count += 1) {
        const target = await claimTarget();
        await failProcurementEvent(dispatcher, target.id, target.leaseToken, "ML_BROKER_REJECTED");
      }
      const recoveryConnection = await publicationRecovery.connect();
      try {
        await recoveryConnection.query("BEGIN");
        await recoverProcurementEventPublication(recoveryConnection, targetId, "ROLLBACK_TEST");
        await recoveryConnection.query("ROLLBACK");
      } finally {
        recoveryConnection.release();
      }
      const rolledBack = await admin.query<{ disposition: string; audits: string }>(`
        SELECT
          (SELECT publication_disposition FROM model_procurement_internal.event_outbox WHERE id = $1) AS disposition,
          (SELECT count(*)::text FROM model_procurement_internal.publication_recovery_audit WHERE event_outbox_id = $1) AS audits
      `, [targetId]);
      expect(rolledBack.rows[0]).toEqual({ disposition: "deadLetter", audits: "1" });

      await expect(recoverProcurementEventPublication(publicationRecovery, targetId, "SECOND_REVIEW")).resolves.toEqual({
        status: "recovered",
        recoveryGeneration: 2,
        priorFailureCount: 5,
        totalFailureCount: 10,
      });
      const republished = await claimTarget();
      await acknowledgeProcurementEvent(dispatcher, republished.id, republished.leaseToken);
      await expect(recoverProcurementEventPublication(publicationRecovery, targetId, "TOO_LATE"))
        .rejects.toMatchObject({ code: "55000", message: expect.stringContaining("ML_PUBLICATION_RECOVERY_STATE") });
    } finally {
      await dispatcher.end();
    }
  });

  it("observes terminal failures through a separate bounded and audited private projection", async () => {
    const created = await clients.employeeOne.openRequest({ amount: usd("43") }, commandOptions("failure-observer"));
    const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await dispatcher.connect();
    let publicationInstanceId = "";
    const terminalConsumer = async (eventId: string): Promise<void> => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await consumer.query(
          "SELECT model_procurement_internal.record_consumer_failure($1, $2, $3, $4)",
          ["consumer:con_10d694c9a0a274dc79c6168e47d25968", eventId, attempt, "ML_HANDLER_UNAVAILABLE"],
        );
      }
    };
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claimed = await claimProcurementEvents(dispatcher, 1000, 60);
        const target = claimed.find((event) => event.targetId === created.id)!;
        expect(target).toBeTruthy();
        publicationInstanceId = target.id;
        for (const event of claimed) {
          if (event.id !== target.id) await releaseProcurementEvent(dispatcher, event.id, event.leaseToken);
        }
        await failProcurementEvent(dispatcher, target.id, target.leaseToken, "ML_BROKER_UNAVAILABLE");
      }

      const firstConsumerId = randomUUID();
      const secondConsumerId = randomUUID();
      await terminalConsumer(firstConsumerId);
      await terminalConsumer(secondConsumerId);

      const auditBefore = await admin.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM model_procurement_internal.failure_observation_audit",
      );
      const firstPage = await observeProcurementTerminalConsumers(failureObserver, { limit: 1 });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();

      const afterSnapshotId = randomUUID();
      await terminalConsumer(afterSnapshotId);
      const observedConsumerIds = firstPage.items.map((item) => item.eventInstanceId);
      let cursor: ConsumerFailureCursor | null = firstPage.nextCursor;
      while (cursor) {
        const page = await observeProcurementTerminalConsumers(failureObserver, { cursor, limit: 1 });
        observedConsumerIds.push(...page.items.map((item) => item.eventInstanceId));
        cursor = page.nextCursor;
      }
      expect(new Set(observedConsumerIds).size).toBe(observedConsumerIds.length);
      expect(observedConsumerIds).toContain(firstConsumerId);
      expect(observedConsumerIds).toContain(secondConsumerId);
      expect(observedConsumerIds).not.toContain(afterSnapshotId);

      const consumerPage = await observeProcurementTerminalConsumers(failureObserver, { limit: 100 });
      const consumerItem = consumerPage.items.find((item) => item.eventInstanceId === afterSnapshotId)!;
      expect(consumerItem).toBeTruthy();
      expect(Object.keys(consumerItem).sort()).toEqual([
        "acknowledged", "claimed", "consumerId", "eventInstanceId", "failureCount", "kind", "lastErrorCode", "maxAttempts",
        "recoveryEligible", "recoveryGeneration", "terminalAt", "totalFailureCount",
      ].sort());
      expect(consumerItem).toMatchObject({
        kind: "consumer",
        consumerId: "consumer:con_10d694c9a0a274dc79c6168e47d25968",
        failureCount: 3,
        totalFailureCount: 3,
        maxAttempts: 3,
        lastErrorCode: "ML_HANDLER_UNAVAILABLE",
        recoveryGeneration: 0,
        recoveryEligible: true,
        acknowledged: false,
        claimed: false,
      });

      const publicationPage = await observeProcurementTerminalPublications(failureObserver, { limit: 100 });
      const publicationItem = publicationPage.items.find((item) => item.eventInstanceId === publicationInstanceId)!;
      expect(publicationItem).toBeTruthy();
      expect(Object.keys(publicationItem).sort()).toEqual([
        "acknowledged", "claimed", "eventId", "eventInstanceId", "failureCount", "kind", "lastErrorCode", "maxAttempts",
        "recoveryEligible", "recoveryGeneration", "terminalAt", "totalFailureCount",
      ].sort());
      expect(publicationItem).toMatchObject({
        kind: "publication",
        failureCount: 5,
        totalFailureCount: 5,
        maxAttempts: 5,
        lastErrorCode: "ML_BROKER_UNAVAILABLE",
        recoveryGeneration: 0,
        recoveryEligible: true,
        acknowledged: false,
        claimed: false,
      });

      await expect(failureObserver.query("SELECT * FROM model_procurement_internal.consumer_failure"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(recoverProcurementEventPublication(failureObserver, publicationInstanceId, "FORGED"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(claimProcurementEvents(failureObserver, 1, 60))
        .rejects.toMatchObject({ code: "42501" });
      await expect(observeProcurementTerminalConsumers(recovery, { limit: 1 }))
        .rejects.toMatchObject({ code: "42501" });
      await expect(observeProcurementTerminalPublications(publicationRecovery, { limit: 1 }))
        .rejects.toMatchObject({ code: "42501" });
      await expect(observeProcurementTerminalConsumers(admin, { limit: 1 }))
        .rejects.toMatchObject({ code: "42501" });
      await expect(observeProcurementTerminalConsumers(failureObserver, { limit: 0 }))
        .rejects.toMatchObject({ code: "22023" });
      await expect(failureObserver.query(
        "SELECT model_procurement_internal.observe_terminal_consumers($1, NULL, NULL, NULL, 1)",
        [new Date().toISOString()],
      )).rejects.toMatchObject({ code: "22023" });

      const observerConnection = await failureObserver.connect();
      try {
        await observerConnection.query("BEGIN");
        await observeProcurementTerminalPublications(observerConnection, { limit: 1 });
        await observerConnection.query("ROLLBACK");
      } finally {
        observerConnection.release();
      }
      const audits = await admin.query<{
        count: string; principals: string[]; kinds: string[]; invalid_counts: string;
      }>(`SELECT count(*)::text AS count,
          pg_catalog.array_agg(DISTINCT database_principal::text) AS principals,
          pg_catalog.array_agg(DISTINCT failure_kind ORDER BY failure_kind) AS kinds,
          count(*) FILTER (WHERE requested_limit NOT BETWEEN 1 AND 100 OR returned_count > requested_limit)::text AS invalid_counts
        FROM model_procurement_internal.failure_observation_audit`);
      expect(Number(audits.rows[0]!.count)).toBeGreaterThan(Number(auditBefore.rows[0]!.count));
      expect(audits.rows[0]!.principals).toEqual(["ml_failure_observer"]);
      expect(audits.rows[0]!.kinds).toEqual(["consumer", "publication"]);
      expect(audits.rows[0]!.invalid_counts).toBe("0");
    } finally {
      await dispatcher.end();
    }
  });

  it("acknowledges one current terminal cycle through an isolated audited authority", async () => {
    const consumerId = recoverableConsumerId;
    const dispatcher = poolFor("ml_dispatcher");
    const application = poolFor("ml_employee_one");
    pools.push(dispatcher, application);
    const { terminalConsumer, terminalPublication } = terminalFailureFixtures(dispatcher);

    const consumerEventId = randomUUID();
    await terminalConsumer(consumerEventId);
    const consumerBefore = await admin.query<{
      failure_count: number; total_failure_count: number; disposition: string; recovery_generation: number;
    }>(`SELECT failure_count, total_failure_count, disposition, recovery_generation
        FROM model_procurement_internal.consumer_failure
        WHERE consumer_id = $1 AND source_event_id = $2`, [consumerId, consumerEventId]);

    const rollbackConnection = await failureAcknowledger.connect();
    try {
      await rollbackConnection.query("BEGIN");
      await expect(acknowledgeProcurementTerminalConsumer(
        rollbackConnection, consumerId, consumerEventId, "ROLLBACK_TEST",
      )).resolves.toMatchObject({ status: "acknowledged", recoveryGeneration: 0 });
      await rollbackConnection.query("ROLLBACK");
    } finally {
      rollbackConnection.release();
    }
    const rolledBackAcknowledgement = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM model_procurement_internal.consumer_failure_acknowledgement
       WHERE consumer_id = $1 AND source_event_id = $2`,
      [consumerId, consumerEventId],
    );
    expect(rolledBackAcknowledgement.rows[0]!.count).toBe("0");

    const concurrentConsumer = await Promise.all([
      acknowledgeProcurementTerminalConsumer(failureAcknowledger, consumerId, consumerEventId, "OPERATOR_REVIEWED"),
      acknowledgeProcurementTerminalConsumer(failureAcknowledger, consumerId, consumerEventId, "SECOND_OPERATOR_REVIEW"),
    ]);
    expect(concurrentConsumer.map((outcome) => outcome.status).sort()).toEqual(["acknowledged", "alreadyAcknowledged"]);
    expect(concurrentConsumer.every((outcome) => outcome.acknowledged && outcome.recoveryGeneration === 0)).toBe(true);
    const consumerAfter = await admin.query<typeof consumerBefore.rows[number]>(
      `SELECT failure_count, total_failure_count, disposition, recovery_generation
       FROM model_procurement_internal.consumer_failure
       WHERE consumer_id = $1 AND source_event_id = $2`,
      [consumerId, consumerEventId],
    );
    expect(consumerAfter.rows).toEqual(consumerBefore.rows);
    const consumerAcknowledgement = await admin.query<{
      count: string; reason_codes: string[]; principals: string[];
    }>(`SELECT count(*)::text AS count,
          pg_catalog.array_agg(reason_code) AS reason_codes,
          pg_catalog.array_agg(database_principal::text) AS principals
        FROM model_procurement_internal.consumer_failure_acknowledgement
        WHERE consumer_id = $1 AND source_event_id = $2`, [consumerId, consumerEventId]);
    expect(consumerAcknowledgement.rows[0]!.count).toBe("1");
    expect(consumerAcknowledgement.rows[0]!.principals).toEqual(["ml_failure_acknowledger"]);
    expect(["OPERATOR_REVIEWED", "SECOND_OPERATOR_REVIEW"]).toContain(consumerAcknowledgement.rows[0]!.reason_codes[0]);

    const observedAcknowledgedConsumer = (await observeProcurementTerminalConsumers(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === consumerEventId)!;
    expect(observedAcknowledgedConsumer.acknowledged).toBe(true);
    expect(Object.keys(observedAcknowledgedConsumer)).not.toContain("reasonCode");
    expect(Object.keys(observedAcknowledgedConsumer)).not.toContain("databasePrincipal");
    expect(Object.keys(observedAcknowledgedConsumer)).not.toContain("acknowledgementAudit");

    await expect(recoverObserveRequestApproval(recovery, consumerEventId, "NEW_CYCLE")).resolves.toMatchObject({
      status: "recovered", recoveryGeneration: 1,
    });
    await terminalConsumer(consumerEventId, 4);
    const laterConsumerCycle = (await observeProcurementTerminalConsumers(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === consumerEventId)!;
    expect(laterConsumerCycle).toMatchObject({ recoveryGeneration: 1, acknowledged: false });

    const publicationTarget = await clients.employeeOne.openRequest({ amount: usd("45") }, commandOptions("failure-ack"));
    const publicationEventId = await terminalPublication(publicationTarget.id);
    const publicationBefore = await admin.query<{
      publication_failure_count: number; publication_total_failure_count: number;
      publication_disposition: string; publication_recovery_generation: number;
    }>(`SELECT publication_failure_count, publication_total_failure_count,
              publication_disposition, publication_recovery_generation
        FROM model_procurement_internal.event_outbox WHERE id = $1`, [publicationEventId]);
    await expect(acknowledgeProcurementTerminalPublication(
      failureAcknowledger, publicationEventId, "OPERATOR_REVIEWED",
    )).resolves.toEqual({ status: "acknowledged", acknowledged: true, recoveryGeneration: 0 });
    await expect(acknowledgeProcurementTerminalPublication(
      failureAcknowledger, publicationEventId, "DIFFERENT_REASON",
    )).resolves.toEqual({ status: "alreadyAcknowledged", acknowledged: true, recoveryGeneration: 0 });
    const publicationAfter = await admin.query<typeof publicationBefore.rows[number]>(
      `SELECT publication_failure_count, publication_total_failure_count,
              publication_disposition, publication_recovery_generation
       FROM model_procurement_internal.event_outbox WHERE id = $1`, [publicationEventId]);
    expect(publicationAfter.rows).toEqual(publicationBefore.rows);
    const observedPublication = (await observeProcurementTerminalPublications(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === publicationEventId)!;
    expect(observedPublication.acknowledged).toBe(true);

    const ackFirstTarget = await clients.employeeOne.openRequest({ amount: usd("46") }, commandOptions("ack-first"));
    const ackFirstEventId = await terminalPublication(ackFirstTarget.id);
    const acknowledgerConnection = await failureAcknowledger.connect();
    const publicationRecoveryConnection = await publicationRecovery.connect();
    try {
      const recoveryPid = (await publicationRecoveryConnection.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      await acknowledgerConnection.query("BEGIN");
      await acknowledgeProcurementTerminalPublication(acknowledgerConnection, ackFirstEventId, "ACK_FIRST");
      const waitingRecovery = recoverProcurementEventPublication(publicationRecoveryConnection, ackFirstEventId, "RECOVER_AFTER_ACK");
      await waitUntilLockWaiting([recoveryPid]);
      await acknowledgerConnection.query("COMMIT");
      await expect(waitingRecovery).resolves.toMatchObject({ status: "recovered", recoveryGeneration: 1 });
    } finally {
      await acknowledgerConnection.query("ROLLBACK").catch(() => undefined);
      acknowledgerConnection.release();
      publicationRecoveryConnection.release();
    }
    const retainedAck = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM model_procurement_internal.publication_failure_acknowledgement
       WHERE event_outbox_id = $1 AND recovery_generation = 0`, [ackFirstEventId],
    );
    expect(retainedAck.rows[0]!.count).toBe("1");
    await terminalPublication(ackFirstTarget.id);
    const newPublicationCycle = (await observeProcurementTerminalPublications(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === ackFirstEventId)!;
    expect(newPublicationCycle).toMatchObject({ recoveryGeneration: 1, acknowledged: false });

    const recoveryFirstTarget = await clients.employeeOne.openRequest({ amount: usd("47") }, commandOptions("recovery-first"));
    const recoveryFirstEventId = await terminalPublication(recoveryFirstTarget.id);
    const recoveryFirstConnection = await publicationRecovery.connect();
    const blockedAcknowledger = await failureAcknowledger.connect();
    try {
      const acknowledgerPid = (await blockedAcknowledger.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      await recoveryFirstConnection.query("BEGIN");
      await recoverProcurementEventPublication(recoveryFirstConnection, recoveryFirstEventId, "RECOVERY_FIRST");
      const waitingAcknowledgement = acknowledgeProcurementTerminalPublication(
        blockedAcknowledger, recoveryFirstEventId, "TOO_LATE",
      );
      await waitUntilLockWaiting([acknowledgerPid]);
      await recoveryFirstConnection.query("COMMIT");
      await expect(waitingAcknowledgement).rejects.toMatchObject({
        code: "55000", message: expect.stringContaining("ML_PUBLICATION_FAILURE_ACKNOWLEDGEMENT_STATE"),
      });
    } finally {
      await recoveryFirstConnection.query("ROLLBACK").catch(() => undefined);
      recoveryFirstConnection.release();
      blockedAcknowledger.release();
    }

    for (const unauthorized of [failureObserver, failureClaimant, recovery, publicationRecovery, consumer, gateway, dispatcher, application, admin]) {
      await expect(acknowledgeProcurementTerminalConsumer(
        unauthorized, consumerId, consumerEventId, "FORGED",
      )).rejects.toMatchObject({ code: "42501" });
    }
    await expect(acknowledgeProcurementTerminalConsumer(
      failureAcknowledger, "consumer:unknown", consumerEventId, "VALID_REASON",
    )).rejects.toMatchObject({ code: "22023" });
    await expect(acknowledgeProcurementTerminalConsumer(
      failureAcknowledger, consumerId, "not-a-uuid", "VALID_REASON",
    )).rejects.toMatchObject({ code: "22023" });
    await expect(acknowledgeProcurementTerminalConsumer(
      failureAcknowledger, consumerId, consumerEventId, "invalid reason",
    )).rejects.toMatchObject({ code: "22023" });

    await expect(failureAcknowledger.query("SELECT * FROM model_procurement_internal.consumer_failure_acknowledgement"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(observeProcurementTerminalConsumers(failureAcknowledger, { limit: 1 }))
      .rejects.toMatchObject({ code: "42501" });
    await expect(recoverObserveRequestApproval(failureAcknowledger, consumerEventId, "FORGED"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(claimProcurementEvents(failureAcknowledger, 1, 60))
      .rejects.toMatchObject({ code: "42501" });
    await expect(failureAcknowledger.query(
      "SELECT model_procurement_internal.consume_observe_request_approval('{}'::jsonb)",
    )).rejects.toMatchObject({ code: "42501" });
    await expect(failureAcknowledger.query("SELECT model_procurement.my_requests()"))
      .rejects.toMatchObject({ code: "42501" });

    const privileges = await admin.query<{
      rolcanlogin: boolean; table_read: boolean; observe: boolean; recover: boolean; claim: boolean;
      acknowledge_publication: boolean; acknowledge_consumer: boolean;
    }>(`SELECT role_value.rolcanlogin,
        pg_catalog.has_table_privilege('modellang_failure_acknowledger', 'model_procurement_internal.consumer_failure', 'SELECT') AS table_read,
        pg_catalog.has_function_privilege('modellang_failure_acknowledger', 'model_procurement_internal.observe_terminal_consumers(timestamptz,timestamptz,text,uuid,integer)', 'EXECUTE') AS observe,
        pg_catalog.has_function_privilege('modellang_failure_acknowledger', 'model_procurement_internal.recover_consumer_failure(text,text,text)', 'EXECUTE') AS recover,
        pg_catalog.has_function_privilege('modellang_failure_acknowledger', 'model_procurement_internal.claim_events(integer,integer)', 'EXECUTE') AS claim,
        pg_catalog.has_function_privilege('modellang_failure_acknowledger', 'model_procurement_internal.acknowledge_terminal_publication_failure(uuid,text)', 'EXECUTE') AS acknowledge_publication,
        pg_catalog.has_function_privilege('modellang_failure_acknowledger', 'model_procurement_internal.acknowledge_terminal_consumer_failure(text,text,text)', 'EXECUTE') AS acknowledge_consumer
      FROM pg_catalog.pg_roles AS role_value WHERE role_value.rolname = 'modellang_failure_acknowledger'`);
    expect(privileges.rows[0]).toEqual({
      rolcanlogin: false,
      table_read: false,
      observe: false,
      recover: false,
      claim: false,
      acknowledge_publication: true,
      acknowledge_consumer: true,
    });
  }, 30_000);

  it("claims one current terminal cycle through an isolated first-writer authority", async () => {
    const consumerId = recoverableConsumerId;
    const dispatcher = poolFor("ml_dispatcher");
    const application = poolFor("ml_employee_one");
    pools.push(dispatcher, application);
    const { terminalConsumer, terminalPublication } = terminalFailureFixtures(dispatcher);

    const consumerEventId = randomUUID();
    await terminalConsumer(consumerEventId);
    const consumerBefore = await admin.query<{
      failure_count: number; total_failure_count: number; disposition: string; recovery_generation: number;
    }>(`SELECT failure_count, total_failure_count, disposition, recovery_generation
        FROM model_procurement_internal.consumer_failure
        WHERE consumer_id = $1 AND source_event_id = $2`, [consumerId, consumerEventId]);

    const rollbackConnection = await failureClaimant.connect();
    try {
      await rollbackConnection.query("BEGIN");
      await expect(claimProcurementTerminalConsumer(
        rollbackConnection, consumerId, consumerEventId,
      )).resolves.toEqual({ status: "claimed", claimed: true, recoveryGeneration: 0 });
      await rollbackConnection.query("ROLLBACK");
    } finally {
      rollbackConnection.release();
    }
    const rolledBackClaim = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM model_procurement_internal.consumer_failure_claim
       WHERE consumer_id = $1 AND source_event_id = $2`,
      [consumerId, consumerEventId],
    );
    expect(rolledBackClaim.rows[0]!.count).toBe("0");

    const concurrentConsumer = await Promise.all([
      claimProcurementTerminalConsumer(failureClaimant, consumerId, consumerEventId),
      claimProcurementTerminalConsumer(failureClaimant, consumerId, consumerEventId),
    ]);
    expect(concurrentConsumer.map((outcome) => outcome.status).sort()).toEqual(["alreadyClaimed", "claimed"]);
    expect(concurrentConsumer.every((outcome) => outcome.claimed && outcome.recoveryGeneration === 0)).toBe(true);
    const consumerAfter = await admin.query<typeof consumerBefore.rows[number]>(
      `SELECT failure_count, total_failure_count, disposition, recovery_generation
       FROM model_procurement_internal.consumer_failure
       WHERE consumer_id = $1 AND source_event_id = $2`,
      [consumerId, consumerEventId],
    );
    expect(consumerAfter.rows).toEqual(consumerBefore.rows);
    const consumerClaim = await admin.query<{ count: string; principals: string[] }>(
      `SELECT count(*)::text AS count, pg_catalog.array_agg(claimant_principal::text) AS principals
       FROM model_procurement_internal.consumer_failure_claim
       WHERE consumer_id = $1 AND source_event_id = $2`,
      [consumerId, consumerEventId],
    );
    expect(consumerClaim.rows[0]).toEqual({ count: "1", principals: ["ml_failure_claimant"] });

    const observedClaimedConsumer = (await observeProcurementTerminalConsumers(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === consumerEventId)!;
    expect(observedClaimedConsumer.claimed).toBe(true);
    expect(Object.keys(observedClaimedConsumer)).not.toContain("claimantPrincipal");
    expect(Object.keys(observedClaimedConsumer)).not.toContain("claimAudit");

    await expect(recoverObserveRequestApproval(recovery, consumerEventId, "CLAIM_NEW_CYCLE")).resolves.toMatchObject({
      status: "recovered", recoveryGeneration: 1,
    });
    await terminalConsumer(consumerEventId, 4);
    const laterConsumerCycle = (await observeProcurementTerminalConsumers(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === consumerEventId)!;
    expect(laterConsumerCycle).toMatchObject({ recoveryGeneration: 1, claimed: false });

    const publicationTarget = await clients.employeeOne.openRequest({ amount: usd("48") }, commandOptions("failure-claim"));
    const publicationEventId = await terminalPublication(publicationTarget.id);
    const publicationBefore = await admin.query<{
      publication_failure_count: number; publication_total_failure_count: number;
      publication_disposition: string; publication_recovery_generation: number;
    }>(`SELECT publication_failure_count, publication_total_failure_count,
              publication_disposition, publication_recovery_generation
        FROM model_procurement_internal.event_outbox WHERE id = $1`, [publicationEventId]);
    await expect(claimProcurementTerminalPublication(failureClaimant, publicationEventId))
      .resolves.toEqual({ status: "claimed", claimed: true, recoveryGeneration: 0 });
    await expect(claimProcurementTerminalPublication(failureClaimant, publicationEventId))
      .resolves.toEqual({ status: "alreadyClaimed", claimed: true, recoveryGeneration: 0 });
    const publicationAfter = await admin.query<typeof publicationBefore.rows[number]>(
      `SELECT publication_failure_count, publication_total_failure_count,
              publication_disposition, publication_recovery_generation
       FROM model_procurement_internal.event_outbox WHERE id = $1`, [publicationEventId]);
    expect(publicationAfter.rows).toEqual(publicationBefore.rows);
    const observedPublication = (await observeProcurementTerminalPublications(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === publicationEventId)!;
    expect(observedPublication.claimed).toBe(true);

    const claimFirstTarget = await clients.employeeOne.openRequest({ amount: usd("49") }, commandOptions("claim-first"));
    const claimFirstEventId = await terminalPublication(claimFirstTarget.id);
    const claimantConnection = await failureClaimant.connect();
    const publicationRecoveryConnection = await publicationRecovery.connect();
    try {
      const recoveryPid = (await publicationRecoveryConnection.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      await claimantConnection.query("BEGIN");
      await claimProcurementTerminalPublication(claimantConnection, claimFirstEventId);
      const waitingRecovery = recoverProcurementEventPublication(publicationRecoveryConnection, claimFirstEventId, "RECOVER_AFTER_CLAIM");
      await waitUntilLockWaiting([recoveryPid]);
      await claimantConnection.query("COMMIT");
      await expect(waitingRecovery).resolves.toMatchObject({ status: "recovered", recoveryGeneration: 1 });
    } finally {
      await claimantConnection.query("ROLLBACK").catch(() => undefined);
      claimantConnection.release();
      publicationRecoveryConnection.release();
    }
    const retainedClaim = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM model_procurement_internal.publication_failure_claim
       WHERE event_outbox_id = $1 AND recovery_generation = 0`, [claimFirstEventId],
    );
    expect(retainedClaim.rows[0]!.count).toBe("1");
    await terminalPublication(claimFirstTarget.id);
    const newPublicationCycle = (await observeProcurementTerminalPublications(failureObserver, { limit: 100 })).items
      .find((item) => item.eventInstanceId === claimFirstEventId)!;
    expect(newPublicationCycle).toMatchObject({ recoveryGeneration: 1, claimed: false });

    const recoveryFirstTarget = await clients.employeeOne.openRequest({ amount: usd("50") }, commandOptions("claim-recovery-first"));
    const recoveryFirstEventId = await terminalPublication(recoveryFirstTarget.id);
    const recoveryFirstConnection = await publicationRecovery.connect();
    const blockedClaimant = await failureClaimant.connect();
    try {
      const claimantPid = (await blockedClaimant.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      await recoveryFirstConnection.query("BEGIN");
      await recoverProcurementEventPublication(recoveryFirstConnection, recoveryFirstEventId, "RECOVERY_BEFORE_CLAIM");
      const waitingClaim = claimProcurementTerminalPublication(blockedClaimant, recoveryFirstEventId);
      await waitUntilLockWaiting([claimantPid]);
      await recoveryFirstConnection.query("COMMIT");
      await expect(waitingClaim).rejects.toMatchObject({
        code: "55000", message: expect.stringContaining("ML_PUBLICATION_FAILURE_CLAIM_STATE"),
      });
    } finally {
      await recoveryFirstConnection.query("ROLLBACK").catch(() => undefined);
      recoveryFirstConnection.release();
      blockedClaimant.release();
    }

    for (const unauthorized of [failureObserver, failureAcknowledger, recovery, publicationRecovery, consumer, gateway, dispatcher, application, admin]) {
      await expect(claimProcurementTerminalConsumer(unauthorized, consumerId, consumerEventId))
        .rejects.toMatchObject({ code: "42501" });
    }
    await expect(claimProcurementTerminalConsumer(failureClaimant, "consumer:unknown", consumerEventId))
      .rejects.toMatchObject({ code: "22023" });
    await expect(claimProcurementTerminalConsumer(failureClaimant, consumerId, "not-a-uuid"))
      .rejects.toMatchObject({ code: "22023" });

    await expect(failureClaimant.query("SELECT * FROM model_procurement_internal.consumer_failure_claim"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(observeProcurementTerminalConsumers(failureClaimant, { limit: 1 }))
      .rejects.toMatchObject({ code: "42501" });
    await expect(recoverObserveRequestApproval(failureClaimant, consumerEventId, "FORGED"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(recoverProcurementEventPublication(failureClaimant, publicationEventId, "FORGED"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(acknowledgeProcurementTerminalConsumer(failureClaimant, consumerId, consumerEventId, "FORGED"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(claimProcurementEvents(failureClaimant, 1, 60))
      .rejects.toMatchObject({ code: "42501" });
    await expect(failureClaimant.query(
      "SELECT model_procurement_internal.consume_observe_request_approval('{}'::jsonb)",
    )).rejects.toMatchObject({ code: "42501" });
    await expect(failureClaimant.query("SELECT model_procurement.my_requests()"))
      .rejects.toMatchObject({ code: "42501" });

    const privileges = await admin.query<{
      rolcanlogin: boolean; table_read: boolean; observe: boolean; recover: boolean;
      acknowledge: boolean; dispatch_claim: boolean; claim_publication: boolean; claim_consumer: boolean;
    }>(`SELECT role_value.rolcanlogin,
        pg_catalog.has_table_privilege('modellang_failure_claimant', 'model_procurement_internal.consumer_failure', 'SELECT') AS table_read,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.observe_terminal_consumers(timestamptz,timestamptz,text,uuid,integer)', 'EXECUTE') AS observe,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.recover_consumer_failure(text,text,text)', 'EXECUTE') AS recover,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.acknowledge_terminal_consumer_failure(text,text,text)', 'EXECUTE') AS acknowledge,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.claim_events(integer,integer)', 'EXECUTE') AS dispatch_claim,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.claim_terminal_publication_failure(uuid)', 'EXECUTE') AS claim_publication,
        pg_catalog.has_function_privilege('modellang_failure_claimant', 'model_procurement_internal.claim_terminal_consumer_failure(text,text)', 'EXECUTE') AS claim_consumer
      FROM pg_catalog.pg_roles AS role_value WHERE role_value.rolname = 'modellang_failure_claimant'`);
    expect(privileges.rows[0]).toEqual({
      rolcanlogin: false,
      table_read: false,
      observe: false,
      recover: false,
      acknowledge: false,
      dispatch_claim: false,
      claim_publication: true,
      claim_consumer: true,
    });
  }, 30_000);

  it("allows exactly one competing lease transition to commit", async () => {
    const created = await clients.employeeOne.openRequest({ amount: usd("44") }, commandOptions("publication-race"));
    const first = new Client({ connectionString: loginUrl("ml_dispatcher") });
    const second = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await Promise.all([first.connect(), second.connect()]);
    try {
      const claimed = await claimProcurementEvents(first, 1000, 60);
      const target = claimed.find((event) => event.targetId === created.id)!;
      for (const event of claimed) {
        if (event.id !== target.id) await releaseProcurementEvent(first, event.id, event.leaseToken);
      }
      const settled = await Promise.allSettled([
        acknowledgeProcurementEvent(first, target.id, target.leaseToken),
        failProcurementEvent(second, target.id, target.leaseToken, "ML_BROKER_REJECTED"),
      ]);
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
      const stored = await admin.query<{ publication_disposition: string; publication_failure_count: number }>(
        "SELECT publication_disposition, publication_failure_count FROM model_procurement_internal.event_outbox WHERE id = $1",
        [target.id],
      );
      expect([
        { publication_disposition: "published", publication_failure_count: 0 },
        { publication_disposition: "pending", publication_failure_count: 1 },
      ]).toContainEqual(stored.rows[0]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("serializes duplicate event delivery, replays the committed result, and keeps inbox state private", async () => {
    const request = await submittedRequest("82");
    const approved = await clients.manager.approveRequest({ request });
    expect(approved.approvalObserved).toBe(false);
    const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
    await dispatcher.connect();
    try {
      const claimed = await dispatcher.query<{ claim_events: RequestApprovedEvent & { leaseToken: string } }>(
        "SELECT model_procurement_internal.claim_events(1000, 60)",
      );
      const target = claimed.rows.map((row) => row.claim_events).find((event) =>
        event.targetId === request && event.eventId === "event:evt_30d694c9a0a274dc79c6168e47d25968")!;
      expect(target).toBeTruthy();
      for (const event of claimed.rows.map((row) => row.claim_events)) {
        if (event.id !== target.id) {
          await dispatcher.query("SELECT model_procurement_internal.release_event($1, $2)", [event.id, event.leaseToken]);
        }
      }
      const { leaseToken, ...envelope } = target;
      await expect(consumer.query(
        "SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb)",
        [{ ...envelope, deliveryAttempt: "1" }],
      )).rejects.toMatchObject({ code: "22023", message: expect.stringContaining("ML_EVENT_ENVELOPE") });
      await expect(consumer.query(
        "SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb)",
        [{ ...envelope, payload: { ...envelope.payload, amount: { currency: "USD", amount: "1e3" } } }],
      )).rejects.toMatchObject({ code: "22023", message: expect.stringContaining("ML_EVENT_PAYLOAD") });
      await expect(consumer.query(
        "SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb)",
        [{ ...envelope, actionId: null, consumerId: null }],
      )).rejects.toMatchObject({ code: "22023", message: expect.stringContaining("ML_EVENT_CONTRACT") });
      await expect(admin.query(`
        INSERT INTO model_procurement_internal.event_outbox
          (model_id, model_version, source_hash, event_id, event_name, payload_entity_id,
           target_id, payload, correlation_id, ordinal)
        VALUES ('model:Procurement', '0.41.0', $1,
                'event:evt_50d694c9a0a274dc79c6168e47d25968', 'ApprovalObserved',
                'entity:ent_9bc680209327484c8e98f5f740bcc702', $2, '{}'::jsonb, 'producer-check', 0)
      `, [envelope.sourceHash, request])).rejects.toMatchObject({ code: "23514" });
      const [first, equivalent] = await Promise.all([
        consumeObserveRequestApproval(consumer, envelope),
        consumeObserveRequestApproval(consumer, envelope),
      ]);
      expect(first).toEqual(equivalent);
      expect(first).toMatchObject({ id: request, status: "APPROVED", approvalObserved: true });
      expect(await consumeObserveRequestApproval(consumer, { ...envelope, deliveryAttempt: 2 })).toEqual(first);

      const conflict = await consumeObserveRequestApproval(consumer, {
        ...envelope,
        payload: { ...envelope.payload, approvalObserved: true },
      }).catch((error: unknown) => error as { code?: string; message?: string });
      expect(conflict).toMatchObject({ code: "40001", message: expect.stringContaining("ML_EVENT_CONFLICT") });

      await expect(consumer.query("SELECT * FROM model_procurement_internal.event_inbox"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(gateway.query(
        "SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb)",
        [envelope],
      )).rejects.toMatchObject({ code: "42501" });
      const evidence = await admin.query<{ inboxes: string; audits: string; failures: string; attempt: number }>(`
        SELECT
          (SELECT count(*)::text FROM model_procurement_internal.event_inbox WHERE source_event_id = $1) AS inboxes,
          (SELECT count(*)::text FROM model_procurement_internal.consumer_audit WHERE source_event_id = $1) AS audits,
          (SELECT count(*)::text FROM model_procurement_internal.consumer_failure WHERE source_event_id = $1::text) AS failures,
          (SELECT last_delivery_attempt FROM model_procurement_internal.event_inbox WHERE source_event_id = $1) AS attempt
      `, [envelope.id]);
      expect(evidence.rows[0]).toEqual({ inboxes: "1", audits: "1", failures: "0", attempt: 2 });
      const downstream = await admin.query<{
        count: string; action_id: string | null; consumer_id: string; correlation_id: string; causation_id: string;
        action_audit_id: string | null; consumer_audit_id: string; command_receipt_id: string | null; payload: { id: string };
      }>(`
        SELECT count(*) OVER ()::text AS count, action_id, consumer_id, correlation_id, causation_id,
               action_audit_id::text, consumer_audit_id::text, command_receipt_id::text, payload
        FROM model_procurement_internal.event_outbox
        WHERE target_id = $1 AND event_id = 'event:evt_50d694c9a0a274dc79c6168e47d25968'
      `, [request]);
      expect(downstream.rows).toEqual([expect.objectContaining({
        count: "1",
        action_id: null,
        consumer_id: "consumer:con_10d694c9a0a274dc79c6168e47d25968",
        correlation_id: envelope.correlationId,
        causation_id: envelope.id,
        action_audit_id: null,
        command_receipt_id: null,
        payload: expect.objectContaining({ id: request, approvalObserved: true }),
      })]);
      expect(downstream.rows[0]!.consumer_audit_id).toBeTruthy();
      await dispatcher.query("SELECT model_procurement_internal.ack_event($1, $2)", [target.id, leaseToken]);
    } finally {
      await dispatcher.end();
    }
  });

  it("rolls back inbox claim, handler effect, audit, and result as one consumer transaction", async () => {
    const request = await submittedRequest("83");
    await clients.manager.approveRequest({ request });
    const eventResult = await admin.query<{ envelope: RequestApprovedEvent }>(`
      SELECT pg_catalog.jsonb_build_object(
        'id', id, 'eventId', event_id, 'eventName', event_name, 'modelId', model_id,
        'modelVersion', model_version, 'sourceHash', source_hash, 'actionId', action_id,
        'consumerId', consumer_id,
        'targetId', target_id, 'payload', payload, 'correlationId', correlation_id,
        'causationId', causation_id, 'occurredAt', occurred_at, 'ordinal', ordinal,
        'deliveryAttempt', 1
      ) AS envelope
      FROM model_procurement_internal.event_outbox
      WHERE target_id = $1 AND event_id = 'event:evt_30d694c9a0a274dc79c6168e47d25968'
    `, [request]);
    const envelope = eventResult.rows[0]!.envelope;
    const connection = new Client({ connectionString: loginUrl("ml_consumer") });
    await connection.connect();
    try {
      await connection.query("BEGIN");
      await consumeObserveRequestApproval(connection, envelope);
      await connection.query("ROLLBACK");
    } finally {
      await connection.end();
    }
    const rolledBack = await admin.query<{ observed: boolean; inboxes: string; audits: string; downstream: string }>(`
      SELECT
        (SELECT approval_observed FROM model_procurement.purchase_request WHERE id = $1) AS observed,
        (SELECT count(*)::text FROM model_procurement_internal.event_inbox WHERE source_event_id = $2) AS inboxes,
        (SELECT count(*)::text FROM model_procurement_internal.consumer_audit WHERE source_event_id = $2) AS audits,
        (SELECT count(*)::text FROM model_procurement_internal.event_outbox
         WHERE target_id = $1 AND event_id = 'event:evt_50d694c9a0a274dc79c6168e47d25968') AS downstream
    `, [request, envelope.id]);
    expect(rolledBack.rows[0]).toEqual({ observed: false, inboxes: "0", audits: "0", downstream: "0" });
    await expect(consumeObserveRequestApproval(consumer, envelope)).resolves.toMatchObject({
      id: request,
      approvalObserved: true,
    });
  });

  it("returns durable retry and dead-letter dispositions without repeating a local effect", async () => {
    const request = await submittedRequest("84");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const invalid = { ...envelope, payload: { ...envelope.payload, status: "SUBMITTED" as const } };

    await expect(deliverObserveRequestApproval(consumer, invalid)).resolves.toMatchObject({
      status: "retry", recorded: true, failureCount: 1, maxAttempts: 3,
      errorCode: "ML_CONSUMER_PRECONDITION",
    });
    await expect(deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt: 2 })).resolves.toMatchObject({
      status: "retry", recorded: true, failureCount: 2, maxAttempts: 3,
    });
    await expect(deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt: 3 })).resolves.toMatchObject({
      status: "deadLetter", recorded: true, failureCount: 3, maxAttempts: 3,
    });
    await expect(deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt: 4 })).resolves.toMatchObject({
      status: "deadLetter", recorded: true, failureCount: 3, maxAttempts: 3,
    });

    const state = await admin.query<{ observed: boolean; failures: string; disposition: string; inboxes: string; audits: string; downstream: string }>(`
      SELECT
        (SELECT approval_observed FROM model_procurement.purchase_request WHERE id = $1) AS observed,
        failure.failure_count::text AS failures,
        failure.disposition,
        (SELECT count(*)::text FROM model_procurement_internal.event_inbox WHERE source_event_id = $2) AS inboxes,
        (SELECT count(*)::text FROM model_procurement_internal.consumer_audit WHERE source_event_id = $2) AS audits,
        (SELECT count(*)::text FROM model_procurement_internal.event_outbox
         WHERE target_id = $1 AND event_id = 'event:evt_50d694c9a0a274dc79c6168e47d25968') AS downstream
      FROM model_procurement_internal.consumer_failure AS failure
      WHERE failure.consumer_id = 'consumer:con_10d694c9a0a274dc79c6168e47d25968'
        AND failure.source_event_id = $2::text
    `, [request, envelope.id]);
    expect(state.rows[0]).toEqual({ observed: false, failures: "3", disposition: "deadLetter", inboxes: "0", audits: "0", downstream: "0" });
    await expect(consumer.query("SELECT * FROM model_procurement_internal.consumer_failure"))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("reopens terminal failure through isolated audited manual recovery", async () => {
    const request = await submittedRequest("88");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const invalid = { ...envelope, payload: { ...envelope.payload, status: "SUBMITTED" as const } };
    for (const deliveryAttempt of [1, 2, 3]) {
      await deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt });
    }

    await expect(consumer.query(
      "SELECT model_procurement_internal.recover_consumer_failure($1, $2, $3)",
      ["consumer:con_10d694c9a0a274dc79c6168e47d25968", envelope.id, "OPERATOR_REVIEWED"],
    )).rejects.toMatchObject({ code: "42501" });
    await expect(recovery.query("SELECT * FROM model_procurement_internal.consumer_recovery_audit"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(recovery.query(
      "SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb)",
      [envelope],
    )).rejects.toMatchObject({ code: "42501" });

    await expect(recoverObserveRequestApproval(recovery, envelope.id, "OPERATOR_REVIEWED")).resolves.toEqual({
      status: "recovered",
      recovered: true,
      recoveryGeneration: 1,
      priorFailureCount: 3,
      totalFailureCount: 3,
    });
    await expect(deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt: 4 })).resolves.toMatchObject({
      status: "retry",
      failureCount: 1,
    });
    await expect(deliverObserveRequestApproval(consumer, { ...envelope, deliveryAttempt: 5 })).resolves.toMatchObject({
      status: "consumed",
      result: { id: request, approvalObserved: true },
    });
    await expect(recoverObserveRequestApproval(recovery, envelope.id, "POST_SUCCESS_CHECK")).resolves.toEqual({
      status: "alreadyConsumed",
      recovered: false,
    });

    const state = await admin.query<{
      disposition: string; cycle_failures: string; total_failures: string; generation: string;
      audits: string; reason: string; operator: string; downstream: string;
    }>(`
      SELECT failure.disposition, failure.failure_count::text AS cycle_failures,
        failure.total_failure_count::text AS total_failures, failure.recovery_generation::text AS generation,
        (SELECT count(*)::text FROM model_procurement_internal.consumer_recovery_audit
         WHERE consumer_id = failure.consumer_id AND source_event_id = failure.source_event_id) AS audits,
        (SELECT reason_code FROM model_procurement_internal.consumer_recovery_audit
         WHERE consumer_id = failure.consumer_id AND source_event_id = failure.source_event_id) AS reason,
        (SELECT database_principal::text FROM model_procurement_internal.consumer_recovery_audit
         WHERE consumer_id = failure.consumer_id AND source_event_id = failure.source_event_id) AS operator,
        (SELECT count(*)::text FROM model_procurement_internal.event_outbox
         WHERE target_id = $1 AND event_id = 'event:evt_50d694c9a0a274dc79c6168e47d25968') AS downstream
      FROM model_procurement_internal.consumer_failure AS failure
      WHERE failure.consumer_id = 'consumer:con_10d694c9a0a274dc79c6168e47d25968'
        AND failure.source_event_id = $2::text
    `, [request, envelope.id]);
    expect(state.rows[0]).toEqual({
      disposition: "resolved",
      cycle_failures: "1",
      total_failures: "4",
      generation: "1",
      audits: "1",
      reason: "OPERATOR_REVIEWED",
      operator: "ml_recovery",
      downstream: "1",
    });
  });

  it("rolls back recovery state and audit together", async () => {
    const request = await submittedRequest("89");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const invalid = { ...envelope, payload: { ...envelope.payload, status: "SUBMITTED" as const } };
    for (const deliveryAttempt of [1, 2, 3]) {
      await deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt });
    }
    const connection = new Client({ connectionString: loginUrl("ml_recovery") });
    await connection.connect();
    try {
      await connection.query("BEGIN");
      await recoverObserveRequestApproval(connection, envelope.id, "ROLLBACK_TEST");
      await connection.query("ROLLBACK");
    } finally {
      await connection.end();
    }
    const state = await admin.query<{ disposition: string; failures: string; generation: string; audits: string }>(`
      SELECT failure.disposition, failure.failure_count::text AS failures,
        failure.recovery_generation::text AS generation,
        (SELECT count(*)::text FROM model_procurement_internal.consumer_recovery_audit
         WHERE consumer_id = failure.consumer_id AND source_event_id = failure.source_event_id) AS audits
      FROM model_procurement_internal.consumer_failure AS failure
      WHERE failure.consumer_id = 'consumer:con_10d694c9a0a274dc79c6168e47d25968'
        AND failure.source_event_id = $1::text
    `, [envelope.id]);
    expect(state.rows[0]).toEqual({ disposition: "deadLetter", failures: "3", generation: "0", audits: "0" });
  });

  it("resolves durable retry state atomically when a later delivery succeeds", async () => {
    const request = await submittedRequest("85");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const invalid = { ...envelope, payload: { ...envelope.payload, status: "SUBMITTED" as const } };
    await expect(deliverObserveRequestApproval(consumer, invalid)).resolves.toMatchObject({ status: "retry", failureCount: 1 });
    const consumed = await deliverObserveRequestApproval(consumer, { ...envelope, deliveryAttempt: 2 });
    expect(consumed).toMatchObject({ status: "consumed", result: { id: request, approvalObserved: true } });

    const state = await admin.query<{ disposition: string; failures: string; resolved: boolean; downstream: string }>(`
      SELECT failure.disposition, failure.failure_count::text AS failures, failure.resolved_at IS NOT NULL AS resolved,
        (SELECT count(*)::text FROM model_procurement_internal.event_outbox
         WHERE target_id = $1 AND event_id = 'event:evt_50d694c9a0a274dc79c6168e47d25968') AS downstream
      FROM model_procurement_internal.consumer_failure AS failure
      WHERE failure.consumer_id = 'consumer:con_10d694c9a0a274dc79c6168e47d25968'
        AND failure.source_event_id = $2::text
    `, [request, envelope.id]);
    expect(state.rows[0]).toEqual({ disposition: "resolved", failures: "1", resolved: true, downstream: "1" });
  });

  it("serializes concurrent failure recording without losing an attempt", async () => {
    const request = await submittedRequest("86");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const invalid = { ...envelope, payload: { ...envelope.payload, status: "SUBMITTED" as const } };

    const outcomes = await Promise.all([
      deliverObserveRequestApproval(consumer, invalid),
      deliverObserveRequestApproval(consumer, { ...invalid, deliveryAttempt: 2 }),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "retry" && outcome.recorded)).toBe(true);
    expect(outcomes.map((outcome) => outcome.status === "consumed" ? null : outcome.failureCount).sort()).toEqual([1, 2]);

    const state = await admin.query<{ failures: string; disposition: string }>(`
      SELECT failure_count::text AS failures, disposition
      FROM model_procurement_internal.consumer_failure
      WHERE consumer_id = 'consumer:con_10d694c9a0a274dc79c6168e47d25968'
        AND source_event_id = $1::text
    `, [envelope.id]);
    expect(state.rows[0]).toEqual({ failures: "2", disposition: "retry" });
  });

  it("lets an in-flight committed success dominate concurrent failure telemetry", async () => {
    const request = await submittedRequest("87");
    await clients.manager.approveRequest({ request });
    const envelope = await requestApprovedEnvelope(request);
    const blocker = new Client({ connectionString: databaseUrl });
    const handler = new Client({ connectionString: loginUrl("ml_consumer") });
    const recorder = new Client({ connectionString: loginUrl("ml_consumer") });
    await Promise.all([blocker.connect(), handler.connect(), recorder.connect()]);
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM model_procurement.purchase_request WHERE id = $1 FOR UPDATE", [request]);
      const handlerPid = (await handler.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const recorderPid = (await recorder.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const handled = handler.query<{ result: object }>(
        'SELECT model_procurement_internal.consume_observe_request_approval($1::jsonb) AS result',
        [envelope],
      );
      await waitUntilLockWaiting([handlerPid]);
      const recorded = recorder.query<{ result: { status: string; recorded: boolean } }>(
        "SELECT model_procurement_internal.record_consumer_failure($1, $2, $3, $4) AS result",
        ["consumer:con_10d694c9a0a274dc79c6168e47d25968", envelope.id, 2, "ML_CONSUMER_HANDLER"],
      );
      await waitUntilLockWaiting([handlerPid, recorderPid]);
      await blocker.query("COMMIT");
      await expect(handled).resolves.toMatchObject({ rows: [{ result: { id: request, approvalObserved: true } }] });
      await expect(recorded).resolves.toMatchObject({ rows: [{ result: { status: "ignoredCommitted", recorded: false } }] });

      const state = await admin.query<{ failures: string; inboxes: string }>(`
        SELECT
          (SELECT count(*)::text FROM model_procurement_internal.consumer_failure WHERE source_event_id = $1::text) AS failures,
          (SELECT count(*)::text FROM model_procurement_internal.event_inbox WHERE source_event_id = $1::uuid) AS inboxes
      `, [envelope.id]);
      expect(state.rows[0]).toEqual({ failures: "0", inboxes: "1" });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.all([blocker.end(), handler.end(), recorder.end()]);
    }
  });

  it("rejects changed retry inputs without disclosing the stored result", async () => {
    const idempotencyKey = `conflict-${randomUUID()}`;
    const correlationId = `correlation-${randomUUID()}`;
    const first = await clients.employeeOne.openRequest(
      { amount: usd("42") },
      { idempotencyKey, correlationId },
    );
    const conflict = await clients.employeeOne.openRequest(
      { amount: usd("43") },
      { idempotencyKey, correlationId },
    ).catch((caught: unknown) => caught);
    expect(conflict).toBeInstanceOf(IdempotencyConflictError);
    expect(conflict).toMatchObject({ code: "40001" });
    expect(JSON.stringify(conflict)).not.toContain(first.id);

    await admin.query(
      `UPDATE model_procurement_internal.command_receipt
       SET source_hash = $2
       WHERE principal_id = '00000000-0000-4000-8000-000000000001' AND idempotency_key = $1`,
      [idempotencyKey, `sha256:${"0".repeat(64)}`],
    );
    const sourceConflict = await clients.employeeOne.openRequest(
      { amount: usd("42") },
      { idempotencyKey, correlationId },
    ).catch((caught: unknown) => caught);
    expect(sourceConflict).toBeInstanceOf(IdempotencyConflictError);
    expect(JSON.stringify(sourceConflict)).not.toContain(first.id);
  });

  it("scopes command identity by principal and serializes equivalent concurrent retries", async () => {
    const sharedAcrossPrincipals = `principal-${randomUUID()}`;
    const [employeeOne, employeeTwo] = await Promise.all([
      clients.employeeOne.openRequest({ amount: usd("44") }, { idempotencyKey: sharedAcrossPrincipals }),
      clients.employeeTwo.openRequest({ amount: usd("44") }, { idempotencyKey: sharedAcrossPrincipals }),
    ]);
    expect(employeeOne.id).not.toBe(employeeTwo.id);

    const concurrentKey = `concurrent-${randomUUID()}`;
    const concurrentOptions = { idempotencyKey: concurrentKey, correlationId: concurrentKey };
    const results = await Promise.all([
      clients.employeeOne.openRequest({ amount: usd("45") }, concurrentOptions),
      clients.employeeOne.openRequest({ amount: usd("45.00") }, concurrentOptions),
    ]);
    expect(results[1]).toEqual(results[0]);
    const counts = await admin.query<{ receipts: string; rows: string; audits: string }>(`
      SELECT
        (SELECT count(*)::text FROM model_procurement_internal.command_receipt
         WHERE principal_id = '00000000-0000-4000-8000-000000000001' AND idempotency_key = $1) AS receipts,
        (SELECT count(*)::text FROM model_procurement.purchase_request WHERE id = $2) AS rows,
        (SELECT count(*)::text FROM model_procurement_internal.action_audit WHERE target_id = $2) AS audits
    `, [concurrentKey, results[0]!.id]);
    expect(counts.rows[0]).toEqual({ receipts: "1", rows: "1", audits: "1" });
  });

  it("rolls back a claimed receipt when reliable command execution fails", async () => {
    const idempotencyKey = `failed-${randomUUID()}`;
    await expect(clients.employeeOne.openRequest(
      { amount: usd("-1") },
      { idempotencyKey },
    )).rejects.toBeInstanceOf(PreconditionError);
    const receipt = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM model_procurement_internal.command_receipt WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(receipt.rows[0]!.count).toBe("0");
  });

  it("enforces workflow initial state and declared edges against direct SQL", async () => {
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
         (requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES
         ('00000000-0000-4000-8000-000000000001', 5000, 'APPROVED',
          '00000000-0000-4000-8000-000000000003', ARRAY['MANAGER']::text[])`,
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "trg_purchase_request_status_workflow_insert",
      message: expect.stringContaining("ML_WORKFLOW:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87"),
    });

    const inserted = await admin.query<{ id: string }>(
      `INSERT INTO model_procurement.purchase_request (requester_id, amount, status)
       VALUES ('00000000-0000-4000-8000-000000000001', 5000, 'DRAFT')
       RETURNING id`,
    );
    const id = inserted.rows[0]!.id;
    try {
      await expect(admin.query(
        `UPDATE model_procurement.purchase_request
         SET status = 'APPROVED',
             approved_by_id = '00000000-0000-4000-8000-000000000003',
             approved_by_roles = ARRAY['MANAGER']::text[]
         WHERE id = $1`,
        [id],
      )).rejects.toMatchObject({
        code: "23514",
        constraint: "trg_purchase_request_status_workflow_update",
        message: expect.stringContaining("ML_WORKFLOW:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87"),
      });
    } finally {
      await admin.query("DELETE FROM model_procurement.purchase_request WHERE id = $1", [id]);
    }
  });

  it("rejects malformed, wrong-currency, and out-of-profile money at every public boundary", async () => {
    await expect(clients.employeeOne.openRequest({
      amount: { currency: "EUR", amount: "1.00" } as unknown as ReturnType<typeof usd>,
    }, commandOptions())).rejects.toMatchObject({
      name: ValidationError.name,
      ruleId: "money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount",
    });
    await expect(clients.employeeOne.openRequest({ amount: usd("1.001") }, commandOptions())).rejects.toBeInstanceOf(ValidationError);
    await expect(clients.employeeOne.openRequest({ amount: usd("1e3") }, commandOptions())).rejects.toBeInstanceOf(ValidationError);

    await expect(pools[0]!.query(
      `WITH execution_context AS MATERIALIZED (
         SELECT pg_catalog.set_config('modellang.idempotency_key', $2, true)
       )
       SELECT model_procurement.open_request($1::numeric) FROM execution_context`,
      ["1.001", `invalid-money-${randomUUID()}`],
    )).rejects.toMatchObject({
      code: "22023",
      message: expect.stringContaining("ML_VALIDATION:money-parameter:"),
    });

    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request (requester_id, amount, status)
       VALUES ('00000000-0000-4000-8000-000000000001', 1.001, 'DRAFT')`,
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_purchase_request_amount_money",
    });
  });

  it("prevents self-approval for every approval tier", async () => {
    const managerRequest = await clients.manager.openRequest({ amount: usd("5000") }, commandOptions());
    await clients.manager.submitRequest({ request: managerRequest.id });
    await expect(clients.manager.approveRequest({ request: managerRequest.id })).rejects.toBeInstanceOf(AuthorizationError);

    const financeRequest = await clients.finance.openRequest({ amount: usd("25000") }, commandOptions());
    await clients.finance.submitRequest({ request: financeRequest.id });
    await expect(clients.finance.approveRequest({ request: financeRequest.id })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("allows each business role to open requests without seed-data role implication", async () => {
    try {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['FINANCE']::text[] WHERE id = '00000000-0000-4000-8000-000000000004'");
      await expect(clients.manager.openRequest({ amount: usd("10") }, commandOptions())).resolves.toMatchObject({
        requester: "00000000-0000-4000-8000-000000000003",
      });
      await expect(clients.finance.openRequest({ amount: usd("10") }, commandOptions())).resolves.toMatchObject({
        requester: "00000000-0000-4000-8000-000000000004",
      });
    } finally {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'FINANCE']::text[] WHERE id = '00000000-0000-4000-8000-000000000004'");
    }
  });

  it("returns only the authenticated caller's requests through the generated read boundary", async () => {
    const employeeOneId = (await clients.employeeOne.openRequest({ amount: usd("11") }, commandOptions())).id;
    const employeeTwoId = (await clients.employeeTwo.openRequest({ amount: usd("12") }, commandOptions())).id;

    const employeeOneRows = await clients.employeeOne.myRequests({});
    const employeeTwoRows = await clients.employeeTwo.myRequests({});
    expect(employeeOneRows.some((request) => request.id === employeeOneId)).toBe(true);
    expect(employeeTwoRows.some((request) => request.id === employeeTwoId)).toBe(true);
    expect(employeeOneRows.every((request) => !Object.hasOwn(request, "requester"))).toBe(true);
    expect(employeeTwoRows.every((request) => !Object.hasOwn(request, "requester"))).toBe(true);
    expect(employeeOneRows.every((request) => Object.hasOwn(request, "approvedBy"))).toBe(true);
    expect(employeeOneRows.find((request) => request.id === employeeOneId)?.amount).toBeNull();
    expect(employeeOneRows.find((request) => request.id === employeeOneId)?.approvedBy).toBeNull();
    expect(employeeOneRows.some((request) => request.id === employeeTwoId)).toBe(false);
    expect(employeeTwoRows.some((request) => request.id === employeeOneId)).toBe(false);
    await expect(clients.unbound.myRequests({})).rejects.toBeInstanceOf(IdentityBindingError);
  });

  it("binds identity before authorization and exposes no actor function argument", async () => {
    await expect(clients.unbound.openRequest({ amount: usd("10") }, commandOptions())).rejects.toBeInstanceOf(IdentityBindingError);
    const functions = await admin.query<{ proname: string; pronargs: number; args: string }>(`
      SELECT p.proname, p.pronargs, pg_catalog.pg_get_function_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'model_procurement'
      ORDER BY p.proname
    `);
    expect(functions.rows).toEqual([
      expect.objectContaining({ proname: "approve_request", pronargs: 1 }),
      expect.objectContaining({ proname: "decide_act_1e35db0451b1461e941af6283d86dca2", pronargs: 2 }),
      expect.objectContaining({ proname: "decide_act_d39dbb883b5f4019b9027b85add3de47", pronargs: 2 }),
      expect.objectContaining({ proname: "decide_act_ed2374e822704c51a2925338253d05d2", pronargs: 2 }),
      expect.objectContaining({ proname: "my_requests", pronargs: 0 }),
      expect.objectContaining({ proname: "open_request", pronargs: 1 }),
      expect.objectContaining({ proname: "submit_request", pronargs: 1 }),
    ]);
    expect(functions.rows.map((row) => row.args).join(" ")).not.toMatch(/actor|principal/i);
  });

  it("separates authenticated applicability from execution without leaking entity existence", async () => {
    const auditBefore = await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM model_procurement_internal.action_audit");
    const impossibleOpen = await clients.employeeOne.assessOpenRequest({ amount: usd("0") });
    expect(impossibleOpen).toMatchObject({
      operationId: "action:act_1e35db0451b1461e941af6283d86dca2",
      status: "notApplicable",
      applicable: false,
      authority: "none",
      revision: expect.stringMatching(/^rev:1:[0-9a-f]{32}$/),
      explanation: {
        kind: "requirement",
        ruleId: "require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount",
      },
    });

    const own = await clients.manager.openRequest({ amount: usd("100") }, commandOptions());
    await clients.manager.submitRequest({ request: own.id });
    const invisible = await clients.manager.assessApproveRequest({ request: randomUUID() });
    const unauthorized = await clients.manager.assessApproveRequest({ request: own.id });
    expect(invisible).toEqual(unauthorized);
    expect(invisible).toEqual({
      operationId: "action:act_d39dbb883b5f4019b9027b85add3de47",
      status: "denied",
      applicable: false,
      authority: "none",
      explanation: {
        kind: "authorization",
        ruleId: "authorize:action:act_d39dbb883b5f4019b9027b85add3de47",
      },
    });
    const auditAfter = await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM model_procurement_internal.action_audit");
    expect(Number(auditAfter.rows[0]!.count) - Number(auditBefore.rows[0]!.count)).toBe(2);
  });

  it("uses explicit revisions only to report stale state and re-evaluates inside execution", async () => {
    const opened = await clients.employeeOne.openRequest({ amount: usd("25") }, commandOptions());
    const decision = await clients.employeeOne.assessSubmitRequest({ request: opened.id });
    expect(decision).toMatchObject({ status: "applicable", applicable: true, authority: "none" });
    expect(decision.revision).toMatch(/^rev:1:[0-9a-f]{32}$/);

    await admin.query("UPDATE model_procurement.purchase_request SET amount = amount WHERE id = $1", [opened.id]);
    await expect(clients.employeeOne.submitRequest(
      { request: opened.id },
      { expectedRevision: decision.revision },
    )).rejects.toMatchObject({ name: StaleError.name, ruleId: "revision:action:act_ed2374e822704c51a2925338253d05d2" });

    const stale = await clients.employeeOne.assessSubmitRequest(
      { request: opened.id },
      { expectedRevision: decision.revision },
    );
    expect(stale).toMatchObject({
      status: "stale",
      applicable: false,
      authority: "none",
      explanation: { kind: "revision", ruleId: "revision:action:act_ed2374e822704c51a2925338253d05d2" },
    });
    await expect(clients.employeeOne.submitRequest({ request: opened.id })).resolves.toMatchObject({ status: "SUBMITTED" });
  });

  it("rolls back durable decision evidence with the action transaction", async () => {
    const connection = new Client({ connectionString: loginUrl("ml_manager") });
    await connection.connect();
    let target: string;
    const rollbackOptions = commandOptions("rollback");
    try {
      await connection.query("BEGIN");
      const result = await new ProcurementClient(connection).openRequest({ amount: usd("19") }, rollbackOptions);
      target = result.id;
      const inside = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.action_audit WHERE target_id = $1`,
        [target],
      ).catch(() => ({ rows: [{ count: "private" }] }));
      expect(inside.rows[0]!.count).toBe("private");
      await connection.query("ROLLBACK");
      const persisted = await admin.query<{ rows: string; evidence: string; receipts: string; events: string }>(`
        SELECT
          (SELECT count(*)::text FROM model_procurement.purchase_request WHERE id = $1) AS rows,
          (SELECT count(*)::text FROM model_procurement_internal.action_audit WHERE target_id = $1) AS evidence,
          (SELECT count(*)::text FROM model_procurement_internal.command_receipt WHERE idempotency_key = $2) AS receipts,
          (SELECT count(*)::text FROM model_procurement_internal.event_outbox WHERE target_id = $1) AS events
      `, [target, rollbackOptions.idempotencyKey]);
      expect(persisted.rows[0]).toEqual({ rows: "0", evidence: "0", receipts: "0", events: "0" });
    } finally {
      await connection.query("ROLLBACK").catch(() => undefined);
      await connection.end();
    }
  });

  it("denies direct mutation, internal access, and owner role assumption", async () => {
    const application = new Client({ connectionString: loginUrl("ml_employee_one") });
    await application.connect();
    try {
      for (const sql of [
        `SELECT * FROM model_procurement.purchase_request`,
        `INSERT INTO model_procurement.purchase_request (id, requester_id, amount, status) VALUES ('${randomUUID()}', '00000000-0000-4000-8000-000000000001', 1, 'DRAFT')`,
        `UPDATE model_procurement.purchase_request SET amount = 2 WHERE false`,
        `DELETE FROM model_procurement.purchase_request WHERE false`,
        `TRUNCATE model_procurement.purchase_request`,
        `SELECT * FROM model_procurement_internal.principal_binding`,
        `SELECT * FROM model_procurement_internal.gateway_principal_binding`,
        `SELECT * FROM model_procurement_internal.action_audit`,
        `SELECT * FROM model_procurement_internal.query_audit`,
        `SELECT * FROM model_procurement_internal.schema_migrations`,
        `SET ROLE modellang_owner`,
      ]) {
        await expect(application.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await application.end();
    }
    const role = await admin.query<{ rolcanlogin: boolean; member: boolean }>(`
      SELECT owner.rolcanlogin,
             pg_catalog.pg_has_role('ml_employee_one', 'modellang_owner', 'MEMBER') AS member
      FROM pg_catalog.pg_roles owner WHERE owner.rolname = 'modellang_owner'
    `);
    expect(role.rows[0]).toEqual({ rolcanlogin: false, member: false });
    const gatewayRole = await admin.query<{ rolcanlogin: boolean; direct_member: boolean }>(`
      SELECT gateway.rolcanlogin,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_auth_members membership
               JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
               WHERE membership.roleid = gateway.oid AND member_role.rolname = 'ml_employee_one'
             ) AS direct_member
      FROM pg_catalog.pg_roles gateway WHERE gateway.rolname = 'modellang_gateway'
    `);
    expect(gatewayRole.rows[0]).toEqual({ rolcanlogin: false, direct_member: false });
  });

  it("uses approval invariants as final backstops and audits successes", async () => {
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 0, 'DRAFT', NULL, NULL)`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_amount_min_exclusive" });
    // Both approval backstops reject this row; PostgreSQL does not promise
    // which violated CHECK constraint it reports first.
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 5, 'APPROVED', NULL, NULL)`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 5, 'DRAFT', '00000000-0000-4000-8000-000000000003', ARRAY['EMPLOYEE', 'MANAGER']::text[])`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approval_fields_match_status" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 5, 'APPROVED', '00000000-0000-4000-8000-000000000004', ARRAY['EMPLOYEE', 'FINANCE']::text[])`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approval_authority_matches_amount" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 25000, 'APPROVED', '00000000-0000-4000-8000-000000000003', ARRAY['EMPLOYEE', 'MANAGER']::text[])`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approval_authority_matches_amount" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_roles)
       VALUES ($1, '00000000-0000-4000-8000-000000000003', 5, 'APPROVED', '00000000-0000-4000-8000-000000000003', ARRAY['MANAGER']::text[])`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approver_differs_from_requester" });

    const id = (await clients.employeeOne.openRequest({ amount: usd("3") }, commandOptions())).id;
    const audit = await admin.query<{
      database_principal: string;
      principal_id: string;
      identity_issuer: string | null;
      identity_subject: string | null;
      count: string;
    }>(
      `SELECT database_principal, principal_id, identity_issuer, identity_subject, count(*)::text AS count
       FROM model_procurement_internal.action_audit
       WHERE action_id = 'action:act_1e35db0451b1461e941af6283d86dca2' AND target_id = $1
       GROUP BY database_principal, principal_id, identity_issuer, identity_subject`,
      [id],
    );
    expect(audit.rows).toEqual([{
      database_principal: "ml_employee_one",
      principal_id: "00000000-0000-4000-8000-000000000001",
      identity_issuer: null,
      identity_subject: null,
      count: "1",
    }]);
  });

  it("enforces valid duplicate-free enum sets while permitting an empty set", async () => {
    for (const roles of [
      ["EMPLOYEE", "EMPLOYEE"],
      ["EMPLOYEE", "UNKNOWN"],
      [null],
    ]) {
      await expect(admin.query(
        `INSERT INTO model_procurement.user (id, name, roles) VALUES ($1, 'Invalid roles', $2::text[])`,
        [randomUUID(), roles],
      )).rejects.toMatchObject({ code: "23514", constraint: "ck_user_roles_enum_set" });
    }
    const emptyId = randomUUID();
    await expect(admin.query(
      `INSERT INTO model_procurement.user (id, name, roles) VALUES ($1, 'No roles', ARRAY[]::text[])`,
      [emptyId],
    )).resolves.toMatchObject({ rowCount: 1 });
    await admin.query("DELETE FROM model_procurement.user WHERE id = $1", [emptyId]);
  });

  it("persists an approval role-set snapshot after the source user roles change", async () => {
    const request = await submittedRequest("5000");
    await clients.manager.approveRequest({ request });
    try {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      const row = await admin.query<{ approved_by_roles: string[] }>(
        "SELECT approved_by_roles FROM model_procurement.purchase_request WHERE id = $1",
        [request],
      );
      expect(row.rows[0]!.approved_by_roles).toEqual(["EMPLOYEE", "MANAGER"]);
    } finally {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
    }
  });

  it("re-evaluates a target after an observed row-lock wait", async () => {
    const request = await submittedRequest("5000");
    const blocker = await admin.connect();
    const manager = new Client({ connectionString: loginUrl("ml_manager") });
    await manager.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM model_procurement.purchase_request WHERE id = $1 FOR UPDATE", [request]);
      const pid = (await manager.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const approval = new ProcurementClient(manager).approveRequest({ request });
      await waitUntilLockWaiting([pid]);
      await blocker.query("UPDATE model_procurement.purchase_request SET amount = 25000 WHERE id = $1", [request]);
      await blocker.query("COMMIT");
      await expect(approval).rejects.toBeInstanceOf(AuthorizationError);
      const row = await admin.query<{ amount: string; status: string }>("SELECT amount::text, status FROM model_procurement.purchase_request WHERE id = $1", [request]);
      expect(row.rows[0]).toEqual({ amount: "25000", status: "SUBMITTED" });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await manager.end();
    }
  });

  it("re-evaluates the principal after an observed principal-row lock wait", async () => {
    const request = await submittedRequest("5000");
    const blocker = await admin.connect();
    const manager = new Client({ connectionString: loginUrl("ml_manager") });
    await manager.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      const pid = (await manager.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const approval = new ProcurementClient(manager).approveRequest({ request });
      await waitUntilLockWaiting([pid]);
      await blocker.query("COMMIT");
      await expect(approval).rejects.toBeInstanceOf(AuthorizationError);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await manager.end();
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
    }
  });

  it("serializes concurrent approvals to exactly one transition and audit record", async () => {
    const request = await submittedRequest("5000");
    const blocker = await admin.connect();
    const first = new Client({ connectionString: loginUrl("ml_manager") });
    const second = new Client({ connectionString: loginUrl("ml_manager") });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM model_procurement.purchase_request WHERE id = $1 FOR UPDATE", [request]);
      const firstPid = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const firstApproval = new ProcurementClient(first).approveRequest({ request });
      const secondApproval = new ProcurementClient(second).approveRequest({ request });
      await waitUntilLockWaiting([firstPid, secondPid]);
      await blocker.query("COMMIT");
      const results = await Promise.allSettled([firstApproval, secondApproval]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
      expect(rejection.reason).toBeInstanceOf(PreconditionError);
      const audit = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.action_audit
         WHERE action_id = 'action:act_d39dbb883b5f4019b9027b85add3de47' AND target_id = $1`,
        [request],
      );
      expect(audit.rows[0]!.count).toBe("1");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("preserves authenticated Procurement semantics through generated HTTP and browser boundaries", async () => {
    const identities = new Map([
      ["employee-one", { issuer: "https://auth.example.test", subject: "employee-one" }],
      ["manager", { issuer: "https://auth.example.test", subject: "manager" }],
      ["finance", { issuer: "https://auth.example.test", subject: "finance" }],
    ]);
    await withHttpServer(async (token) => {
      const identity = identities.get(token);
      return identity ? createProcurementGatewayExecutor(gateway, identity) : null;
    }, async (baseUrl) => {
      const employee = new ProcurementHttpClient({ baseUrl, accessToken: () => "employee-one" });
      const manager = new ProcurementHttpClient({ baseUrl, accessToken: () => "manager" });
      const finance = new ProcurementHttpClient({ baseUrl, accessToken: () => "finance" });
      const employeeUi = createProcurementUiExecutor(employee);
      const employeeWorkflow = createProcurementUiWorkflowExecutor(employee);
      const managerWorkflow = createProcurementUiWorkflowExecutor(manager);
      const financeWorkflow = createProcurementUiWorkflowExecutor(finance);
      const openDescriptor = ProcurementUiManifest.actions.find((action) => action.name === "openRequest")!;
      const requestsDescriptor = ProcurementUiManifest.queries.find((query) => query.name === "myRequests")!;

      await expect(employee.openRequest({ amount: usd("0") }, commandOptions())).rejects.toBeInstanceOf(PreconditionError);
      const low = await employeeUi.execute(openDescriptor.operationId, { amount: usd("5000") }, commandOptions());
      expect(low.requester).toBe("00000000-0000-4000-8000-000000000001");
      const workflow = ProcurementUiManifest.workflows[0]!;
      const submit = employeeWorkflow.available(workflow.workflowId, low.status)[0]!;
      const submitDecision = await employeeWorkflow.assessTransition(submit.transitionId, low.id, {});
      expect(submitDecision).toMatchObject({ status: "applicable", authority: "none" });
      const submitted = await employeeWorkflow.executeTransition(
        submit.transitionId,
        low.id,
        {},
        { expectedRevision: submitDecision.revision },
      );
      const approveOperationId = "action:act_d39dbb883b5f4019b9027b85add3de47" as const;
      const candidate = [{ operationId: approveOperationId, input: { request: low.id } }] as const;
      const [employeeCapabilities, managerCapabilities] = await Promise.all([
        employee.subjectCapabilities(candidate),
        manager.subjectCapabilities(candidate),
      ]);
      expect(employeeCapabilities).toMatchObject({
        available: [],
        unavailable: [{ operationId: approveOperationId, status: "denied", authority: "none" }],
      });
      expect(managerCapabilities).toMatchObject({
        available: [{ operationId: approveOperationId, status: "applicable", authority: "none" }],
        unavailable: [],
      });
      expect(JSON.stringify([employeeCapabilities, managerCapabilities])).not.toContain(low.id);
      const discoveryAudit = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.action_audit
         WHERE action_id = $1 AND target_id = $2`,
        [approveOperationId, low.id],
      );
      expect(discoveryAudit.rows[0]!.count).toBe("0");
      const readAuditBefore = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.query_audit
         WHERE query_id = 'query:qry_4406b045404a48449282db804f6167a8'
           AND principal_id = '00000000-0000-4000-8000-000000000001'`,
      );
      const currentRequests = await employee.readMyRequestsResource({});
      expect(currentRequests).toMatchObject({
        operationId: "query:qry_4406b045404a48449282db804f6167a8",
        authority: "none",
        freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
      });
      expect(currentRequests.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: low.id, status: "SUBMITTED" }),
      ]));
      expect(JSON.stringify(currentRequests)).not.toMatch(/requester|identity_subject|query_audit/);
      const readAuditAfter = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.query_audit
         WHERE query_id = 'query:qry_4406b045404a48449282db804f6167a8'
           AND principal_id = '00000000-0000-4000-8000-000000000001'`,
      );
      expect(Number(readAuditAfter.rows[0]!.count)).toBe(Number(readAuditBefore.rows[0]!.count) + 1);
      const approve = managerWorkflow.available(workflow.workflowId, submitted.status)[0]!;
      expect(await managerWorkflow.assessTransition(approve.transitionId, low.id, {}))
        .toMatchObject({ status: "applicable", authority: "none" });
      const approved = await managerWorkflow.executeTransition(approve.transitionId, low.id, {});
      expect(approved).toMatchObject({
        status: "APPROVED",
        approvedBy: "00000000-0000-4000-8000-000000000003",
      });

      const high = await employee.openRequest({ amount: usd("25000") }, commandOptions());
      const highSubmit = employeeWorkflow.available(workflow.workflowId, high.status)[0]!;
      const highSubmitted = await employeeWorkflow.executeTransition(highSubmit.transitionId, high.id, {});
      const highApprove = managerWorkflow.available(workflow.workflowId, highSubmitted.status)[0]!;
      expect(await managerWorkflow.assessTransition(highApprove.transitionId, high.id, {}))
        .toMatchObject({ status: "denied", authority: "none" });
      expect(await financeWorkflow.assessTransition(highApprove.transitionId, high.id, {}))
        .toMatchObject({ status: "applicable", authority: "none" });
      await expect(managerWorkflow.executeTransition(highApprove.transitionId, high.id, {}))
        .rejects.toBeInstanceOf(AuthorizationError);
      expect((await financeWorkflow.executeTransition(highApprove.transitionId, high.id, {})).status).toBe("APPROVED");
      expect((await employeeUi.execute(requestsDescriptor.operationId, {})).map((request) => request.id))
        .toEqual(expect.arrayContaining([low.id, high.id]));

      const beforeSpoof = (await employee.myRequests({})).length;
      const spoof = await fetch(`${baseUrl}/operations/actions/act_1e35db0451b1461e941af6283d86dca2`, {
        method: "POST",
        headers: {
          authorization: "Bearer employee-one",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: "00000000-0000-4000-8000-000000000004",
          amount: usd("10"),
        }),
      });
      expect(spoof.status).toBe(400);
      expect((await employee.myRequests({})).length).toBe(beforeSpoof);

      const invalid = new ProcurementHttpClient({ baseUrl, accessToken: () => "invalid" });
      await expect(invalid.myRequests({})).rejects.toBeInstanceOf(AuthenticationError);
    });
  });

  it("preserves authentication, runtime policy, and current-state evidence through MCP", async () => {
    const endpoint = new URL("https://procurement.example.test/mcp");
    let authenticationCount = 0;
    let unexpectedError: Error | undefined;
    const handler = createProcurementMcpHandler(async (token) => {
      authenticationCount += 1;
      if (token !== "employee-one") return null;
      return {
        authInfo: {
          token,
          clientId: "procurement-live-test",
          scopes: ["modellang"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: new URL(endpoint.href),
        },
        executor: createProcurementGatewayExecutor(gateway, {
          issuer: "https://auth.example.test",
          subject: "employee-one",
        }),
      };
    }, { resourceServerUrl: endpoint.href, onerror: (error) => { unexpectedError = error; } });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: "Bearer employee-one" } },
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    });
    const mcp = new McpClient(
      { name: "procurement-live-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const queryId = "query:qry_4406b045404a48449282db804f6167a8";
    try {
      await mcp.connect(transport);
      const tools = await mcp.listTools();
      expect(tools.tools).toHaveLength(4);

      const opened = await mcp.callTool({
        name: "act_1e35db0451b1461e941af6283d86dca2",
        arguments: { amount: usd("654.32") },
        _meta: { "dev.modellang/idempotencyKey": `mcp-live-open-${randomUUID()}` },
      });
      expect(opened.isError).not.toBe(true);
      const request = opened.structuredContent as { id: string; requester: string; status: string };
      expect(request).toMatchObject({
        requester: "00000000-0000-4000-8000-000000000001",
        status: "DRAFT",
      });

      const submitted = await mcp.callTool({
        name: "act_ed2374e822704c51a2925338253d05d2",
        arguments: { request: request.id },
      });
      expect(submitted.isError, unexpectedError?.stack ?? JSON.stringify(submitted)).not.toBe(true);
      expect(submitted.structuredContent).toMatchObject({ status: "SUBMITTED" });

      const denied = await mcp.callTool({
        name: "act_d39dbb883b5f4019b9027b85add3de47",
        arguments: { request: request.id },
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).toContain(
        "authorize:action:act_d39dbb883b5f4019b9027b85add3de47",
      );

      const auditBefore = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.query_audit
         WHERE query_id = $1 AND principal_id = '00000000-0000-4000-8000-000000000001'`,
        [queryId],
      );
      const current = await mcp.callTool({
        name: "qry_4406b045404a48449282db804f6167a8",
        arguments: {},
      });
      expect(current.isError).not.toBe(true);
      expect(current.structuredContent).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: request.id, status: "SUBMITTED" }),
      ]));
      const embedded = current.content.find((content) => content.type === "resource");
      expect(embedded?.type).toBe("resource");
      if (embedded?.type === "resource" && "text" in embedded.resource) {
        expect(JSON.parse(embedded.resource.text)).toMatchObject({
          operationId: queryId,
          authority: "none",
          freshness: { mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" },
        });
        expect(embedded.resource._meta).toMatchObject({
          "dev.modellang/cacheControl": "no-store",
          "dev.modellang/maxAgeSeconds": 0,
        });
      }
      const auditAfter = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM model_procurement_internal.query_audit
         WHERE query_id = $1 AND principal_id = '00000000-0000-4000-8000-000000000001'`,
        [queryId],
      );
      expect(Number(auditAfter.rows[0]!.count)).toBe(Number(auditBefore.rows[0]!.count) + 1);
      expect(authenticationCount).toBeGreaterThanOrEqual(6);
    } finally {
      await Promise.all([mcp.close(), handler.close()]);
    }
  });

  it("binds gateway identity per transaction without leaking across pooled requests or rollbacks", async () => {
    const employee = createProcurementGatewayExecutor(gateway, {
      issuer: "https://auth.example.test",
      subject: "employee-one",
    });
    const manager = createProcurementGatewayExecutor(gateway, {
      issuer: "https://auth.example.test",
      subject: "manager",
    });
    const unbound = createProcurementGatewayExecutor(gateway, {
      issuer: "https://auth.example.test",
      subject: "unknown",
    });

    await expect(employee.execute("action:act_1e35db0451b1461e941af6283d86dca2", {
      amount: usd("0"),
    }, commandOptions("gateway-precondition"))).rejects.toBeInstanceOf(PreconditionError);

    const [employeeRequest, managerRequest] = await Promise.all([
      employee.execute(
        "action:act_1e35db0451b1461e941af6283d86dca2",
        { amount: usd("101") },
        commandOptions("gateway-employee"),
      ),
      manager.execute(
        "action:act_1e35db0451b1461e941af6283d86dca2",
        { amount: usd("102") },
        commandOptions("gateway-manager"),
      ),
    ]) as [{ id: string; requester: string }, { id: string; requester: string }];
    expect(employeeRequest.requester).toBe("00000000-0000-4000-8000-000000000001");
    expect(managerRequest.requester).toBe("00000000-0000-4000-8000-000000000003");
    await employee.execute("query:qry_4406b045404a48449282db804f6167a8", {});
    await expect(unbound.execute("query:qry_4406b045404a48449282db804f6167a8", {}))
      .rejects.toBeInstanceOf(IdentityBindingError);

    const connection = await gateway.connect();
    try {
      await expect(connection.query("SELECT * FROM model_procurement_internal.gateway_principal_binding"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(connection.query("SELECT * FROM model_procurement_internal.resolve_principal()"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(connection.query("SELECT model_procurement.my_requests()"))
        .rejects.toMatchObject({ message: expect.stringContaining("ML_IDENTITY_UNBOUND") });
    } finally {
      connection.release();
    }

    const audit = await admin.query<{
      target_id: string;
      database_principal: string;
      identity_issuer: string;
      identity_subject: string;
    }>(
      `SELECT target_id, database_principal, identity_issuer, identity_subject
       FROM model_procurement_internal.action_audit
       WHERE target_id = ANY($1::uuid[])
       ORDER BY target_id`,
      [[employeeRequest.id, managerRequest.id]],
    );
    expect(audit.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target_id: employeeRequest.id,
        database_principal: "ml_gateway",
        identity_issuer: "https://auth.example.test",
        identity_subject: "employee-one",
      }),
      expect.objectContaining({
        target_id: managerRequest.id,
        database_principal: "ml_gateway",
        identity_issuer: "https://auth.example.test",
        identity_subject: "manager",
      }),
    ]));
    const readAudit = await admin.query<{ database_principal: string; identity_issuer: string; identity_subject: string }>(`
      SELECT database_principal, identity_issuer, identity_subject
      FROM model_procurement_internal.query_audit
      WHERE query_id = 'query:qry_4406b045404a48449282db804f6167a8'
        AND principal_id = '00000000-0000-4000-8000-000000000001'
      ORDER BY id DESC LIMIT 1
    `);
    expect(readAudit.rows[0]).toEqual({
      database_principal: "ml_gateway",
      identity_issuer: "https://auth.example.test",
      identity_subject: "employee-one",
    });
  });

  it("ignores forged gateway settings from direct-login application roles", async () => {
    const connection = await pools[0]!.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL modellang.gateway_issuer = 'https://auth.example.test'");
      await connection.query("SET LOCAL modellang.gateway_subject = 'finance'");
      const request = await new ProcurementClient(connection).openRequest({ amount: usd("103") }, commandOptions("gateway"));
      expect(request.requester).toBe("00000000-0000-4000-8000-000000000001");
      await connection.query("COMMIT");
      await expect(connection.query(
        "SELECT model_procurement_internal.bind_gateway_identity($1, $2)",
        ["https://auth.example.test", "finance"],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await connection.query("ROLLBACK").catch(() => undefined);
      connection.release();
    }
  });
});
