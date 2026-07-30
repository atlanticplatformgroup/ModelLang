import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReservationsClient } from "../../generated/reservations/typescript/client.js";
import {
  ConflictError, NotFoundError, PreconditionError,
} from "../../generated/reservations/typescript/errors.js";
import {
  databaseUrl, installReservationsDatabase, loginUrl, poolFor,
} from "../../scripts/database.js";

const resource = "20000000-0000-4000-8000-000000000001";
const otherResource = "20000000-0000-4000-8000-000000000002";
let firstPool: Pool;
let secondPool: Pool;
let firstClient: ReservationsClient;
let secondClient: ReservationsClient;
let admin: Pool;

beforeAll(async () => {
  await installReservationsDatabase();
  firstPool = poolFor("ml_reserver_one");
  secondPool = poolFor("ml_reserver_two");
  firstClient = new ReservationsClient(firstPool);
  secondClient = new ReservationsClient(secondPool);
  admin = new Pool({ connectionString: databaseUrl });
}, 30_000);

afterAll(async () => {
  await Promise.all([firstPool?.end(), secondPool?.end(), admin?.end()]);
});

async function waitUntilLockWaiting(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_catalog.pg_stat_activity
         WHERE pid = $1 AND wait_event_type = 'Lock'
       ) AS waiting`,
      [pid],
    );
    if (result.rows[0]!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${pid} did not enter an observed PostgreSQL lock wait`);
}

describe.sequential("ModelLang reservation and query boundaries", () => {
  it("allows adjacent half-open intervals and rejects overlap", async () => {
    const first = await firstClient.reserve({
      resource,
      startsAt: "2030-01-10T10:00:00.000Z",
      endsAt: "2030-01-10T11:00:00.000Z",
    });
    expect(first).toMatchObject({
      resource,
      reservedBy: "10000000-0000-4000-8000-000000000001",
      startsAt: "2030-01-10T10:00:00+00:00",
      endsAt: "2030-01-10T11:00:00+00:00",
    });
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
    await expect(secondClient.reserve({
      resource,
      startsAt: "2030-01-10T11:00:00.000Z",
      endsAt: "2030-01-10T12:00:00.000Z",
    })).resolves.toMatchObject({ resource });
    const overlapError = await secondClient.reserve({
      resource,
      startsAt: "2030-01-10T10:30:00.000Z",
      endsAt: "2030-01-10T11:30:00.000Z",
    }).catch((error: unknown) => error);
    expect(overlapError).toBeInstanceOf(ConflictError);
    expect(overlapError).toMatchObject({
      code: "23P01",
      ruleId: "ex_reservation_no_overlapping_reservations",
    });
  });

  it("rejects invalid intervals at the named action boundary", async () => {
    await expect(firstClient.reserve({
      resource,
      startsAt: "2030-02-01T10:00:00.000Z",
      endsAt: "2030-02-01T10:00:00.000Z",
    })).rejects.toBeInstanceOf(PreconditionError);
    await expect(admin.query(
      `INSERT INTO model_reservations.reservation
       (id, resource_id, reserved_by_id, starts_at, ends_at)
       VALUES ($1, $2, '10000000-0000-4000-8000-000000000001', $3, $3)`,
      [randomUUID(), resource, "2030-02-01T10:00:00.000Z"],
    )).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_reservation_no_overlapping_reservations_valid_interval",
    });
  });

  it("returns one resource's rows without leaking rows from another resource", async () => {
    const firstId = (await firstClient.reserve({
      resource,
      startsAt: "2031-01-01T09:00:00.000Z",
      endsAt: "2031-01-01T10:00:00.000Z",
    })).id;
    const secondId = (await secondClient.reserve({
      resource: otherResource,
      startsAt: "2031-01-01T09:00:00.000Z",
      endsAt: "2031-01-01T10:00:00.000Z",
    })).id;

    const firstRows = await firstClient.reservationsForResource({ resource });
    const secondRows = await firstClient.reservationsForResource({ resource: otherResource });
    expect(firstRows.some((reservation) => reservation.id === firstId)).toBe(true);
    expect(secondRows.some((reservation) => reservation.id === secondId)).toBe(true);
    expect(firstRows.every((reservation) => reservation.resource === resource)).toBe(true);
    expect(secondRows.every((reservation) => reservation.resource === otherResource)).toBe(true);
    expect(firstRows.some((reservation) => reservation.id === secondId)).toBe(false);
    await expect(firstClient.reservationsForResource({
      resource: "20000000-0000-4000-8000-000000000099",
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("serializes concurrent conflicting reservations to exactly one row and audit record", async () => {
    const first = new Client({ connectionString: loginUrl("ml_reserver_one") });
    const second = new Client({ connectionString: loginUrl("ml_reserver_two") });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query("BEGIN");
      const firstId = (await new ReservationsClient(first).reserve({
        resource,
        startsAt: "2030-03-01T09:00:00.000Z",
        endsAt: "2030-03-01T10:00:00.000Z",
      })).id;

      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const conflicting = new ReservationsClient(second).reserve({
        resource,
        startsAt: "2030-03-01T09:30:00.000Z",
        endsAt: "2030-03-01T10:30:00.000Z",
      });
      await waitUntilLockWaiting(secondPid);
      await first.query("COMMIT");
      await expect(conflicting).rejects.toBeInstanceOf(ConflictError);

      const rows = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM model_reservations.reservation
         WHERE resource_id = $1
           AND starts_at >= '2030-03-01T09:00:00.000Z'
           AND starts_at < '2030-03-01T11:00:00.000Z'`,
        [resource],
      );
      expect(rows.rows[0]!.count).toBe("1");
      const audits = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM model_reservations_internal.action_audit
         WHERE action_id = 'action:act_508ad810a19d4b79a5009871de5cd26b' AND target_id = $1`,
        [firstId],
      );
      expect(audits.rows[0]!.count).toBe("1");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("retains the direct-mutation privilege boundary", async () => {
    const application = new Client({ connectionString: loginUrl("ml_reserver_one") });
    await application.connect();
    try {
      await expect(application.query(
        "SELECT * FROM model_reservations.reservation",
      )).rejects.toMatchObject({ code: "42501" });
      await expect(application.query(
        "UPDATE model_reservations.reservation SET ends_at = ends_at WHERE false",
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await application.end();
    }
  });
});
