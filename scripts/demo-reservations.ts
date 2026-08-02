import { resolve } from "node:path";
import { Client } from "pg";
import { compileFile } from "../src/compiler.js";
import { writeGeneratedAtomically } from "../src/build.js";
import { enforcementText } from "../src/codegen/enforcement.js";
import { ReservationsClient } from "../generated/reservations/typescript/client.js";
import { consumeIndexReservation } from "../generated/reservations/typescript/consumers.js";
import type { ReservationCreatedEvent } from "../generated/reservations/typescript/events.js";
import { ConflictError } from "../generated/reservations/typescript/errors.js";
import { installReservationsDatabase, loginUrl, poolFor } from "./database.js";

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
  const consumerPool = poolFor("ml_consumer");
  const dispatcher = new Client({ connectionString: loginUrl("ml_dispatcher") });
  await dispatcher.connect();
  const first = new ReservationsClient(firstPool);
  const second = new ReservationsClient(secondPool);
  const resource = "20000000-0000-4000-8000-000000000001";
  try {
    const firstReservation = await first.reserve({
      resource,
      startsAt: "2031-01-10T10:00:00.000Z",
      endsAt: "2031-01-10T11:00:00.000Z",
    }, { idempotencyKey: "demo-reserve-first" });
    line(3, "Reserve Conference Room A from 10:00 to 11:00", "PASS");
    const claimed = await dispatcher.query<{ claim_events: ReservationCreatedEvent & { leaseToken: string } }>(
      "SELECT model_reservations_internal.claim_events(1000, 60)",
    );
    const createdEvent = claimed.rows.map((row) => row.claim_events).find((event) => event.targetId === firstReservation.id)!;
    const { leaseToken, ...envelope } = createdEvent;
    const indexed = await consumeIndexReservation(consumerPool, envelope);
    if (!indexed.indexed) throw new Error("Reservation consumer did not commit its local effect");
    await dispatcher.query("SELECT model_reservations_internal.ack_event($1, $2)", [createdEvent.id, leaseToken]);
    line(4, "Consumer indexes ReservationCreated exactly once locally", "PASS");
    await second.reserve({
      resource,
      startsAt: "2031-01-10T11:00:00.000Z",
      endsAt: "2031-01-10T12:00:00.000Z",
    }, { idempotencyKey: "demo-reserve-adjacent" });
    line(5, "Reserve adjacent half-open interval from 11:00 to 12:00", "PASS");
    const conflict = await second.reserve({
      resource,
      startsAt: "2031-01-10T10:30:00.000Z",
      endsAt: "2031-01-10T11:30:00.000Z",
    }, { idempotencyKey: "demo-reserve-conflict" }).catch((error: unknown) => error);
    if (!(conflict instanceof ConflictError)) throw new Error("Overlapping reservation unexpectedly succeeded");
    line(6, "Attempt overlapping reservation from 10:30 to 11:30", "REJECTED as designed");
    const firstPage = await first.reservationsForResource({ resource });
    const secondPage = firstPage.nextCursor
      ? await first.reservationsForResource({ resource, cursor: firstPage.nextCursor })
      : { items: [], nextCursor: null };
    const visible = [...firstPage.items, ...secondPage.items];
    if (visible.length !== 2 || secondPage.nextCursor !== null || visible.some((reservation) => reservation.resource.id !== resource)) {
      throw new Error("Resource-scoped query returned an unexpected result");
    }
    line(7, "Read Conference Room A through cursor pages", "PASS");
    line(8, "Temporal/read rules -> PostgreSQL enforcement mapping");
    process.stdout.write(`\n${enforcementText(ir)}\n`);
  } finally {
    await Promise.all([firstPool.end(), secondPool.end(), consumerPool.end()]);
    await dispatcher.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`RESERVATIONS DEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
