import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProcurementClient } from "../../generated/procurement/typescript/client.js";
import { ProcurementHttpClient } from "../../generated/procurement/typescript/http-client.js";
import {
  createProcurementDatabaseExecutor,
  createProcurementHttpHandler,
  type ProcurementAuthenticator,
} from "../../generated/procurement/typescript/http-server.js";
import {
  AuthenticationError, AuthorizationError, IdentityBindingError, PreconditionError, ValidationError,
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

function usd(amount: string): { currency: "USD"; amount: string } {
  return { currency: "USD", amount };
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
  pools.push(employeeOne, employeeTwo, manager, finance, unbound);
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
  const opened = await clients.employeeOne.openRequest({ amount: usd(amount) });
  await clients.employeeOne.submitRequest({ request: opened.id });
  return opened.id;
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
    await expect(clients.employeeOne.openRequest({ amount: usd("0") })).rejects.toBeInstanceOf(PreconditionError);
    const opened = await clients.employeeOne.openRequest({ amount: usd("5000") });
    const low = opened.id;
    expect(opened).toMatchObject({
      requester: "00000000-0000-4000-8000-000000000001",
      amount: { currency: "USD", amount: "5000.00" },
      status: "DRAFT",
      approvedBy: null,
    });
    expect(opened.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(opened.createdAt))).toBe(false);
    await expect(clients.employeeTwo.submitRequest({ request: low })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await clients.employeeOne.submitRequest({ request: low })).status).toBe("SUBMITTED");
    const approvedLow = await clients.manager.approveRequest({ request: low });
    expect(approvedLow).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000003",
      approvedByRoles: ["EMPLOYEE", "MANAGER"],
    });

    const high = await submittedRequest("25000");
    await expect(clients.manager.approveRequest({ request: high })).rejects.toBeInstanceOf(AuthorizationError);
    const approvedHigh = await clients.finance.approveRequest({ request: high });
    expect(approvedHigh).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000004",
      approvedByRoles: ["EMPLOYEE", "FINANCE"],
    });

    const managerRequest = await clients.manager.openRequest({ amount: usd("25") });
    expect(managerRequest).toMatchObject({
      requester: "00000000-0000-4000-8000-000000000003",
    });
    expect((await clients.manager.myRequests({})).some((request) => request.id === managerRequest.id)).toBe(true);
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
    })).rejects.toMatchObject({
      name: ValidationError.name,
      ruleId: "money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount",
    });
    await expect(clients.employeeOne.openRequest({ amount: usd("1.001") })).rejects.toBeInstanceOf(ValidationError);
    await expect(clients.employeeOne.openRequest({ amount: usd("1e3") })).rejects.toBeInstanceOf(ValidationError);

    await expect(pools[0]!.query(
      `SELECT model_procurement.open_request($1::numeric)`,
      ["1.001"],
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
    const managerRequest = await clients.manager.openRequest({ amount: usd("5000") });
    await clients.manager.submitRequest({ request: managerRequest.id });
    await expect(clients.manager.approveRequest({ request: managerRequest.id })).rejects.toBeInstanceOf(AuthorizationError);

    const financeRequest = await clients.finance.openRequest({ amount: usd("25000") });
    await clients.finance.submitRequest({ request: financeRequest.id });
    await expect(clients.finance.approveRequest({ request: financeRequest.id })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("allows each business role to open requests without seed-data role implication", async () => {
    try {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['FINANCE']::text[] WHERE id = '00000000-0000-4000-8000-000000000004'");
      await expect(clients.manager.openRequest({ amount: usd("10") })).resolves.toMatchObject({
        requester: "00000000-0000-4000-8000-000000000003",
      });
      await expect(clients.finance.openRequest({ amount: usd("10") })).resolves.toMatchObject({
        requester: "00000000-0000-4000-8000-000000000004",
      });
    } finally {
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'MANAGER']::text[] WHERE id = '00000000-0000-4000-8000-000000000003'");
      await admin.query("UPDATE model_procurement.user SET roles = ARRAY['EMPLOYEE', 'FINANCE']::text[] WHERE id = '00000000-0000-4000-8000-000000000004'");
    }
  });

  it("returns only the authenticated caller's requests through the generated read boundary", async () => {
    const employeeOneId = (await clients.employeeOne.openRequest({ amount: usd("11") })).id;
    const employeeTwoId = (await clients.employeeTwo.openRequest({ amount: usd("12") })).id;

    const employeeOneRows = await clients.employeeOne.myRequests({});
    const employeeTwoRows = await clients.employeeTwo.myRequests({});
    expect(employeeOneRows.some((request) => request.id === employeeOneId)).toBe(true);
    expect(employeeTwoRows.some((request) => request.id === employeeTwoId)).toBe(true);
    expect(employeeOneRows.every((request) => request.requester === "00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(employeeTwoRows.every((request) => request.requester === "00000000-0000-4000-8000-000000000002")).toBe(true);
    expect(employeeOneRows.some((request) => request.id === employeeTwoId)).toBe(false);
    expect(employeeTwoRows.some((request) => request.id === employeeOneId)).toBe(false);
    await expect(clients.unbound.myRequests({})).rejects.toBeInstanceOf(IdentityBindingError);
  });

  it("binds identity before authorization and exposes no actor function argument", async () => {
    await expect(clients.unbound.openRequest({ amount: usd("10") })).rejects.toBeInstanceOf(IdentityBindingError);
    const functions = await admin.query<{ proname: string; pronargs: number; args: string }>(`
      SELECT p.proname, p.pronargs, pg_catalog.pg_get_function_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'model_procurement'
      ORDER BY p.proname
    `);
    expect(functions.rows).toEqual([
      expect.objectContaining({ proname: "approve_request", pronargs: 1 }),
      expect.objectContaining({ proname: "my_requests", pronargs: 0 }),
      expect.objectContaining({ proname: "open_request", pronargs: 1 }),
      expect.objectContaining({ proname: "submit_request", pronargs: 1 }),
    ]);
    expect(functions.rows.map((row) => row.args).join(" ")).not.toMatch(/actor|principal/i);
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

    const id = (await clients.employeeOne.openRequest({ amount: usd("3") })).id;
    const audit = await admin.query<{ database_principal: string; principal_id: string; count: string }>(
      `SELECT database_principal, principal_id, count(*)::text AS count
       FROM model_procurement_internal.action_audit
       WHERE action_id = 'action:act_1e35db0451b1461e941af6283d86dca2' AND target_id = $1
       GROUP BY database_principal, principal_id`,
      [id],
    );
    expect(audit.rows).toEqual([{
      database_principal: "ml_employee_one",
      principal_id: "00000000-0000-4000-8000-000000000001",
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
    const executors = new Map([
      ["employee-one", createProcurementDatabaseExecutor(clients.employeeOne)],
      ["manager", createProcurementDatabaseExecutor(clients.manager)],
      ["finance", createProcurementDatabaseExecutor(clients.finance)],
    ]);
    await withHttpServer(async (token) => executors.get(token) ?? null, async (baseUrl) => {
      const employee = new ProcurementHttpClient({ baseUrl, accessToken: () => "employee-one" });
      const manager = new ProcurementHttpClient({ baseUrl, accessToken: () => "manager" });
      const finance = new ProcurementHttpClient({ baseUrl, accessToken: () => "finance" });

      await expect(employee.openRequest({ amount: usd("0") })).rejects.toBeInstanceOf(PreconditionError);
      const low = await employee.openRequest({ amount: usd("5000") });
      expect(low.requester).toBe("00000000-0000-4000-8000-000000000001");
      await employee.submitRequest({ request: low.id });
      const approved = await manager.approveRequest({ request: low.id });
      expect(approved).toMatchObject({
        status: "APPROVED",
        approvedBy: "00000000-0000-4000-8000-000000000003",
      });

      const high = await employee.openRequest({ amount: usd("25000") });
      await employee.submitRequest({ request: high.id });
      await expect(manager.approveRequest({ request: high.id })).rejects.toBeInstanceOf(AuthorizationError);
      expect((await finance.approveRequest({ request: high.id })).status).toBe("APPROVED");
      expect((await employee.myRequests({})).map((request) => request.id)).toEqual(expect.arrayContaining([low.id, high.id]));

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
});
