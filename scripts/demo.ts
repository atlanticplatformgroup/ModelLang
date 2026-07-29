import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { compileFile } from "../src/compiler.js";
import { writeGeneratedAtomically } from "../src/build.js";
import { enforcementText } from "../src/codegen/enforcement.js";
import { ProcurementClient } from "../generated/typescript/client.js";
import {
  AuthorizationError, IdentityBindingError, PreconditionError,
} from "../generated/typescript/errors.js";
import {
  applyGeneratedSql, databaseUrl, poolFor, provisionDemoLogins, resetGeneratedSchemas,
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
  await writeGeneratedAtomically(ir, resolve("generated"));

  line(2, "Apply generated SQL");
  await resetGeneratedSchemas();
  await applyGeneratedSql();

  line(3, "Create local demo login roles");
  await provisionDemoLogins();
  const seed = await readFile(resolve("generated/postgres/005_seed.sql"), "utf8");
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(seed);
  line(4, "Seed users and provision principal bindings");

  const employeePool = poolFor("ml_employee_one");
  const managerPool = poolFor("ml_manager");
  const financePool = poolFor("ml_finance");
  const unboundPool = poolFor("ml_unbound");
  const employee = new ProcurementClient(employeePool);
  const manager = new ProcurementClient(managerPool);
  const finance = new ProcurementClient(financePool);
  const unbound = new ProcurementClient(unboundPool);
  try {
    const low = randomUUID();
    await employee.openRequest({ id: low, amount: "5000" });
    line(5, "Employee login opens a 5,000 request", "PASS");
    await employee.submitRequest({ request: low });
    line(6, "Owner employee login submits the request", "PASS");
    await manager.approveRequest({ request: low });
    line(7, "Manager login approves the 5,000 request", "PASS");

    const high = randomUUID();
    await employee.openRequest({ id: high, amount: "25000" });
    line(8, "Employee login opens a 25,000 request", "PASS");
    await employee.submitRequest({ request: high });
    line(9, "Owner employee login submits the request", "PASS");
    await expectError(manager.approveRequest({ request: high }), AuthorizationError);
    line(10, "Manager login attempts to approve 25,000", "REJECTED as designed");
    await finance.approveRequest({ request: high });
    line(11, "Finance login approves 25,000", "PASS");

    await expectError(unbound.openRequest({ id: randomUUID(), amount: "10" }), IdentityBindingError);
    line(12, "Unbound login attempts an action", "REJECTED as designed");
    try {
      await employeePool.query("UPDATE model_procurement.purchase_request SET amount = 1 WHERE id = $1", [low]);
      throw new Error("Direct update unexpectedly succeeded");
    } catch (error) {
      if ((error as { code?: string }).code !== "42501") throw error;
    }
    line(13, "Application login attempts direct table UPDATE", "REJECTED as designed");

    line(14, "Ontology rule -> identity/lock/enforcement mapping");
    process.stdout.write(`\n${enforcementText(ir)}\n`);
  } finally {
    await Promise.all([employeePool.end(), managerPool.end(), financePool.end(), unboundPool.end()]);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`DEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
