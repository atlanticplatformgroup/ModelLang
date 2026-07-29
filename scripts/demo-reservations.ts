import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { compileFile } from "../src/compiler.js";
import { writeGeneratedAtomically } from "../src/build.js";
import { enforcementText } from "../src/codegen/enforcement.js";
import { ReservationsClient } from "../generated/reservations/typescript/client.js";
import { ConflictError } from "../generated/reservations/typescript/errors.js";
import { installReservationsDatabase, poolFor } from "./database.js";

function line(number: number, text: string, result?: string): void {
  process.stdout.write(`${`${number}. ${text}`.padEnd(68)}${result ?? ""}\n`);
}

async function main(): Promise<void> {
  line(1, "Compile Reservations.model");
  const ir = await compileFile(resolve("examples/reservations.model"));
  await writeGeneratedAtomically(ir, resolve("generated/reservations"));
  line(2, "Apply temporal exclusion schema and provision identities");
  await installReservationsDatabase();

  const firstPool = poolFor("ml_reserver_one");
  const secondPool = poolFor("ml_reserver_two");
  const first = new ReservationsClient(firstPool);
  const second = new ReservationsClient(secondPool);
  const resource = "20000000-0000-4000-8000-000000000001";
  try {
    await first.reserve({
      id: randomUUID(), resource,
      startsAt: "2031-01-10T10:00:00.000Z",
      endsAt: "2031-01-10T11:00:00.000Z",
    });
    line(3, "Reserve Conference Room A from 10:00 to 11:00", "PASS");
    await second.reserve({
      id: randomUUID(), resource,
      startsAt: "2031-01-10T11:00:00.000Z",
      endsAt: "2031-01-10T12:00:00.000Z",
    });
    line(4, "Reserve adjacent half-open interval from 11:00 to 12:00", "PASS");
    const conflict = await second.reserve({
      id: randomUUID(), resource,
      startsAt: "2031-01-10T10:30:00.000Z",
      endsAt: "2031-01-10T11:30:00.000Z",
    }).catch((error: unknown) => error);
    if (!(conflict instanceof ConflictError)) throw new Error("Overlapping reservation unexpectedly succeeded");
    line(5, "Attempt overlapping reservation from 10:30 to 11:30", "REJECTED as designed");
    line(6, "Temporal rule -> PostgreSQL enforcement mapping");
    process.stdout.write(`\n${enforcementText(ir)}\n`);
  } finally {
    await Promise.all([firstPool.end(), secondPool.end()]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`RESERVATIONS DEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
