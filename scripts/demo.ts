import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { compileFile } from "../src/compiler.js";
import { writeGeneratedAtomically } from "../src/build.js";
import { enforcementText } from "../src/codegen/enforcement.js";
import { ProcurementClient } from "../generated/procurement/typescript/client.js";
import { consumeObserveRequestApproval } from "../generated/procurement/typescript/consumers.js";
import type { RequestApprovedEvent } from "../generated/procurement/typescript/events.js";
import {
  AuthorizationError, IdentityBindingError, PreconditionError,
} from "../generated/procurement/typescript/errors.js";
import {
  applyGeneratedSql, databaseUrl, loginUrl, poolFor, provisionDemoLogins, resetGeneratedSchemas,
} from "./database.js";

function line(number: number, text: string, result?: string): void {
  const prefix = `${number}. ${text}`;
  process.stdout.write(`${prefix.padEnd(64)}${result ?? ""}\n`);
}

async function expectError(operation: Promise<unknown>, type: new (...args: never[]) => Error): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof type) return;
    throw error;
  }
  throw new Error(`Expected ${type.name}`);
}

async function main(): Promise<void> {
  line(1, "Compile Procurement.model");
  const ir = await compileFile(resolve("examples/procurement.model"));
  await writeGeneratedAtomically(ir, resolve("generated/procurement"));

  line(2, "Apply generated SQL");
  await resetGeneratedSchemas();
  await applyGeneratedSql();

  line(3, "Create local demo login roles");
  await provisionDemoLogins();
  const seed = await readFile(resolve("generated/procurement/postgres/005_seed.sql"), "utf8");
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(seed);
  line(4, "Seed users and provision principal bindings");

  const employeePool = poolFor("ml_employee_one");
  const managerPool = poolFor("ml_manager");
  const financePool = poolFor("ml_finance");
  const unboundPool = poolFor("ml_unbound");
  const consumerPool = poolFor("ml_consumer");
  const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
  await dispatcher.connect();
  const employee = new ProcurementClient(employeePool);
  const manager = new ProcurementClient(managerPool);
  const finance = new ProcurementClient(financePool);
  const unbound = new ProcurementClient(unboundPool);
  try {
    const low = (await employee.openRequest(
      { amount: { currency: "USD", amount: "5000.00" } },
      { idempotencyKey: "demo-low" },
    )).id;
    line(5, "Employee login opens a 5,000 request", "PASS");
    await employee.submitRequest({ request: low });
    line(6, "Owner employee login submits the request", "PASS");
    await manager.approveRequest({ request: low });
    line(7, "Manager login approves the 5,000 request", "PASS");
    const claimed = await dispatcher.query<{ claim_events: RequestApprovedEvent & { leaseToken: string } }>(
      "SELECT model_procurement_internal.claim_events(1000, 60)",
    );
    const approvalEvent = claimed.rows.map((row) => row.claim_events).find((event) =>
      event.targetId === low && event.eventId === "event:evt_30d694c9a0a274dc79c6168e47d25968")!;
    for (const event of claimed.rows.map((row) => row.claim_events)) {
      if (event.id !== approvalEvent.id) {
        await dispatcher.query("SELECT model_procurement_internal.release_event($1, $2)", [event.id, event.leaseToken]);
      }
    }
    const { leaseToken, ...envelope } = approvalEvent;
    const consumed = await consumeObserveRequestApproval(consumerPool, envelope);
    if (!consumed.approvalObserved) throw new Error("Approval consumer did not commit its local effect");
    await dispatcher.query("SELECT model_procurement_internal.ack_event($1, $2)", [approvalEvent.id, leaseToken]);
    line(8, "Consumer handles RequestApproved exactly once locally", "PASS");

    const managerOwned = (await manager.openRequest(
      { amount: { currency: "USD", amount: "50.00" } },
      { idempotencyKey: "demo-manager" },
    )).id;
    line(9, "Multi-role manager opens an employee request", "PASS");

    const high = (await employee.openRequest(
      { amount: { currency: "USD", amount: "25000.00" } },
      { idempotencyKey: "demo-high" },
    )).id;
    line(10, "Employee login opens a 25,000 request", "PASS");
    await employee.submitRequest({ request: high });
    line(11, "Owner employee login submits the request", "PASS");
    await expectError(manager.approveRequest({ request: high }), AuthorizationError);
    line(12, "Manager login attempts to approve 25,000", "REJECTED as designed");
    await finance.approveRequest({ request: high });
    line(13, "Finance login approves 25,000", "PASS");

    const visible = await employee.myRequests({});
    if (!visible.some((request) => request.id === low)
      || !visible.some((request) => request.id === high)
      || visible.some((request) => request.id === managerOwned)) {
      throw new Error("Caller-scoped query did not return the employee's requests");
    }
    line(14, "Employee query excludes the manager's request", "PASS");

    await expectError(unbound.openRequest(
      { amount: { currency: "USD", amount: "10.00" } },
      { idempotencyKey: "demo-unbound" },
    ), IdentityBindingError);
    line(15, "Unbound login attempts an action", "REJECTED as designed");
    try {
      await employeePool.query("SELECT * FROM model_procurement.purchase_request");
      throw new Error("Direct select unexpectedly succeeded");
    } catch (error) {
      if ((error as { code?: string }).code !== "42501") throw error;
    }
    line(16, "Application login attempts direct table SELECT", "REJECTED as designed");
    try {
      await employeePool.query("UPDATE model_procurement.purchase_request SET amount = 1 WHERE id = $1", [low]);
      throw new Error("Direct update unexpectedly succeeded");
    } catch (error) {
      if ((error as { code?: string }).code !== "42501") throw error;
    }
    line(17, "Application login attempts direct table UPDATE", "REJECTED as designed");

    line(18, "Ontology rule -> identity/lock/enforcement mapping");
    process.stdout.write(`\n${enforcementText(ir)}\n`);
  } finally {
    await Promise.all([employeePool.end(), managerPool.end(), financePool.end(), unboundPool.end(), consumerPool.end()]);
    await dispatcher.end();
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`DEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
