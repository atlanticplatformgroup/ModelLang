import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAll } from "../../src/build.js";
import { compileText } from "../../src/compiler.js";

const databaseUrl = process.env.MODELLANG_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/modellang";
const actorId = "91000000-0000-4000-8000-000000000001";
const rollbackRequestId = "92000000-0000-4000-8000-000000000001";
const concurrentRequestId = "92000000-0000-4000-8000-000000000002";
const replayRequestId = "92000000-0000-4000-8000-000000000003";

const source = `model AtomicEffects version "0.50.0";
enum RequestState { PENDING, APPROVED }
entity User { id: UUID @id; }
entity Request { id: UUID @id; state: RequestState = RequestState.PENDING; }
entity Result { id: UUID @id @generated(uuid); request: Request @unique; actor: User; }
action approve(caller actor: User, request: Request) -> Result {
  authorize true;
  require pending: request.state == RequestState.PENDING;
  idempotency required;
  update request { state = RequestState.APPROVED; }
  create Result { request = request; actor = actor; }
}
workflow RequestLifecycle for Request.state {
  initial RequestState.PENDING;
  transition approve: RequestState.PENDING -> RequestState.APPROVED by approve;
}
`;

let admin: Pool;

async function approve(client: Client, requestId: string, idempotencyKey: string): Promise<{ id: string }> {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_catalog.set_config('modellang.idempotency_key', $1, true)`, [idempotencyKey]);
    const result = await client.query<{ value: { id: string } }>(
      `SELECT model_atomic_effects.approve($1::uuid) AS value`,
      [requestId],
    );
    await client.query("COMMIT");
    return result.rows[0]!.value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

beforeAll(async () => {
  admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`DROP SCHEMA IF EXISTS model_atomic_effects_internal CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS model_atomic_effects CASCADE`);
  const generated = generateAll(compileText(source, "atomic-effects.model"));
  for (const artifact of ["postgres/001_roles.sql", "postgres/002_schema.sql", "postgres/003_actions.sql", "postgres/003_decisions.sql", "postgres/004_grants.sql"]) {
    await admin.query(generated[artifact]!);
  }
  await admin.query(`INSERT INTO model_atomic_effects."user" (id) VALUES ($1)`, [actorId]);
  await admin.query(`INSERT INTO model_atomic_effects.request (id) VALUES ($1), ($2), ($3)`, [rollbackRequestId, concurrentRequestId, replayRequestId]);
  await admin.query(`INSERT INTO model_atomic_effects.result (request_id, actor_id) VALUES ($1, $2)`, [rollbackRequestId, actorId]);
  await admin.query(`INSERT INTO model_atomic_effects_internal.principal_binding (database_principal, principal_id) VALUES ('postgres', $1)`, [actorId]);
}, 30_000);

afterAll(async () => {
  await admin?.query(`DROP SCHEMA IF EXISTS model_atomic_effects_internal CASCADE`);
  await admin?.query(`DROP SCHEMA IF EXISTS model_atomic_effects CASCADE`);
  await admin?.end();
});

describe("ModelLang 0.50 atomic multi-entity effects", () => {
  it("rolls back an earlier workflow update when the later create violates a constraint", async () => {
    const connection = new Client({ connectionString: databaseUrl });
    await connection.connect();
    try {
      await expect(approve(connection, rollbackRequestId, "rollback-proof")).rejects.toMatchObject({ code: "23505" });
    } finally {
      await connection.end();
    }
    const state = await admin.query<{ state: string }>(`SELECT state FROM model_atomic_effects.request WHERE id = $1`, [rollbackRequestId]);
    const evidence = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM model_atomic_effects_internal.action_effect_audit AS effect
      JOIN model_atomic_effects_internal.action_audit AS action ON action.id = effect.action_audit_id
      WHERE action.action_id = 'action:approve' AND effect.target_id = $1`, [rollbackRequestId]);
    expect(state.rows[0]!.state).toBe("PENDING");
    expect(evidence.rows[0]!.count).toBe(0);
  });

  it("serializes concurrent approvals into one complete committed effect set", async () => {
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    try {
      const outcomes = await Promise.allSettled([
        approve(first, concurrentRequestId, "concurrent-first"),
        approve(second, concurrentRequestId, "concurrent-second"),
      ]);
      const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<{ id: string }> => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "P0001" });

      const resultId = fulfilled[0]!.value.id;
      const committed = await admin.query<{ state: string; result_count: number }>(`
        SELECT request.state,
          (SELECT count(*)::int FROM model_atomic_effects.result WHERE request_id = request.id) AS result_count
        FROM model_atomic_effects.request AS request WHERE request.id = $1`, [concurrentRequestId]);
      const evidence = await admin.query<{ effect_ordinal: number; effect_kind: string; entity_id: string; target_id: string }>(`
        SELECT effect.effect_ordinal, effect.effect_kind, effect.entity_id, effect.target_id
        FROM model_atomic_effects_internal.action_effect_audit AS effect
        JOIN model_atomic_effects_internal.action_audit AS action ON action.id = effect.action_audit_id
        WHERE action.action_id = 'action:approve' AND action.target_id = $1
        ORDER BY effect.effect_ordinal`, [resultId]);
      expect(committed.rows[0]).toMatchObject({ state: "APPROVED", result_count: 1 });
      expect(evidence.rows).toEqual([
        { effect_ordinal: 0, effect_kind: "update", entity_id: "entity:Request", target_id: concurrentRequestId },
        { effect_ordinal: 1, effect_kind: "create", entity_id: "entity:Result", target_id: resultId },
      ]);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("replays the stored final result without repeating any effect", async () => {
    const connection = new Client({ connectionString: databaseUrl });
    await connection.connect();
    try {
      const first = await approve(connection, replayRequestId, "replay-whole-effect-set");
      const replay = await approve(connection, replayRequestId, "replay-whole-effect-set");
      expect(replay).toEqual(first);
      const counts = await admin.query<{ result_count: number; action_count: number; effect_count: number }>(`
        SELECT
          (SELECT count(*)::int FROM model_atomic_effects.result WHERE request_id = $1) AS result_count,
          (SELECT count(*)::int FROM model_atomic_effects_internal.action_audit WHERE action_id = 'action:approve' AND target_id = $2) AS action_count,
          (SELECT count(*)::int
           FROM model_atomic_effects_internal.action_effect_audit AS effect
           JOIN model_atomic_effects_internal.action_audit AS action ON action.id = effect.action_audit_id
           WHERE action.action_id = 'action:approve' AND action.target_id = $2) AS effect_count`, [replayRequestId, first.id]);
      expect(counts.rows[0]).toEqual({ result_count: 1, action_count: 1, effect_count: 2 });
    } finally {
      await connection.end();
    }
  });
});
