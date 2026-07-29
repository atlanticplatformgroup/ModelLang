import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProcurementClient } from "../../generated/procurement/typescript/client.js";
import {
  AuthorizationError, IdentityBindingError, PreconditionError,
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
  const id = randomUUID();
  await clients.employeeOne.openRequest({ id, amount });
  await clients.employeeOne.submitRequest({ request: id });
  return id;
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
    const low = randomUUID();
    await expect(clients.employeeOne.openRequest({ id: randomUUID(), amount: "0" })).rejects.toBeInstanceOf(PreconditionError);
    const opened = await clients.employeeOne.openRequest({ id: low, amount: "5000" });
    expect(opened).toMatchObject({
      id: low,
      requester: "00000000-0000-4000-8000-000000000001",
      amount: "5000",
      status: "DRAFT",
      approvedBy: null,
    });
    await expect(clients.employeeTwo.submitRequest({ request: low })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await clients.employeeOne.submitRequest({ request: low })).status).toBe("SUBMITTED");
    const approvedLow = await clients.manager.approveRequest({ request: low });
    expect(approvedLow).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000003",
      approvedByRole: "MANAGER",
    });

    const high = await submittedRequest("25000");
    await expect(clients.manager.approveRequest({ request: high })).rejects.toBeInstanceOf(AuthorizationError);
    const approvedHigh = await clients.finance.approveRequest({ request: high });
    expect(approvedHigh).toMatchObject({
      status: "APPROVED",
      approvedBy: "00000000-0000-4000-8000-000000000004",
      approvedByRole: "FINANCE",
    });
  });

  it("binds identity before authorization and exposes no actor function argument", async () => {
    await expect(clients.unbound.openRequest({ id: randomUUID(), amount: "10" })).rejects.toBeInstanceOf(IdentityBindingError);
    const functions = await admin.query<{ proname: string; pronargs: number; args: string }>(`
      SELECT p.proname, p.pronargs, pg_catalog.pg_get_function_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'model_procurement'
      ORDER BY p.proname
    `);
    expect(functions.rows).toEqual([
      expect.objectContaining({ proname: "approve_request", pronargs: 1 }),
      expect.objectContaining({ proname: "open_request", pronargs: 2 }),
      expect.objectContaining({ proname: "submit_request", pronargs: 1 }),
    ]);
    expect(functions.rows.map((row) => row.args).join(" ")).not.toMatch(/actor|principal/i);
  });

  it("denies direct mutation, internal access, and owner role assumption", async () => {
    const application = new Client({ connectionString: loginUrl("ml_employee_one") });
    await application.connect();
    try {
      for (const sql of [
        `INSERT INTO model_procurement.purchase_request (id, requester_id, amount, status) VALUES ('${randomUUID()}', '00000000-0000-4000-8000-000000000001', 1, 'DRAFT')`,
        `UPDATE model_procurement.purchase_request SET amount = 2 WHERE false`,
        `DELETE FROM model_procurement.purchase_request WHERE false`,
        `TRUNCATE model_procurement.purchase_request`,
        `SELECT * FROM model_procurement_internal.principal_binding`,
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

  it("uses the bidirectional approval invariant as a final backstop and audits successes", async () => {
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_role)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 0, 'DRAFT', NULL, NULL)`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_amount_min_exclusive" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_role)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 5, 'APPROVED', NULL, NULL)`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approval_fields_match_status" });
    await expect(admin.query(
      `INSERT INTO model_procurement.purchase_request
       (id, requester_id, amount, status, approved_by_id, approved_by_role)
       VALUES ($1, '00000000-0000-4000-8000-000000000001', 5, 'DRAFT', '00000000-0000-4000-8000-000000000003', 'MANAGER')`,
      [randomUUID()],
    )).rejects.toMatchObject({ code: "23514", constraint: "ck_purchase_request_approval_fields_match_status" });

    const id = randomUUID();
    await clients.employeeOne.openRequest({ id, amount: "3" });
    const audit = await admin.query<{ database_principal: string; principal_id: string; count: string }>(
      `SELECT database_principal, principal_id, count(*)::text AS count
       FROM model_procurement_internal.action_audit
       WHERE action_id = 'action:openRequest' AND target_id = $1
       GROUP BY database_principal, principal_id`,
      [id],
    );
    expect(audit.rows).toEqual([{
      database_principal: "ml_employee_one",
      principal_id: "00000000-0000-4000-8000-000000000001",
      count: "1",
    }]);
  });

  it("persists an approval role snapshot after the source user role changes", async () => {
    const request = await submittedRequest("5000");
    await clients.manager.approveRequest({ request });
    try {
      await admin.query("UPDATE model_procurement.user SET role = 'EMPLOYEE' WHERE id = '00000000-0000-4000-8000-000000000003'");
      const row = await admin.query<{ approved_by_role: string }>(
        "SELECT approved_by_role FROM model_procurement.purchase_request WHERE id = $1",
        [request],
      );
      expect(row.rows[0]!.approved_by_role).toBe("MANAGER");
    } finally {
      await admin.query("UPDATE model_procurement.user SET role = 'MANAGER' WHERE id = '00000000-0000-4000-8000-000000000003'");
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
      await blocker.query("UPDATE model_procurement.user SET role = 'EMPLOYEE' WHERE id = '00000000-0000-4000-8000-000000000003'");
      const pid = (await manager.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const approval = new ProcurementClient(manager).approveRequest({ request });
      await waitUntilLockWaiting([pid]);
      await blocker.query("COMMIT");
      await expect(approval).rejects.toBeInstanceOf(AuthorizationError);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await manager.end();
      await admin.query("UPDATE model_procurement.user SET role = 'MANAGER' WHERE id = '00000000-0000-4000-8000-000000000003'");
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
         WHERE action_id = 'action:approveRequest' AND target_id = $1`,
        [request],
      );
      expect(audit.rows[0]!.count).toBe("1");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.all([first.end(), second.end()]);
    }
  });
});
