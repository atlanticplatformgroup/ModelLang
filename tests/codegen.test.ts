import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { generateAll } from "../src/build.js";

async function procurement() {
  const source = await readFile("examples/procurement.model", "utf8");
  return compileText(source, "examples/procurement.model");
}

async function reservations() {
  const source = await readFile("examples/reservations.model", "utf8");
  return compileText(source, "examples/reservations.model");
}

describe("backends", () => {
  it("generates deterministic output from IR only", async () => {
    const ir = await procurement();
    expect(generateAll(ir)).toEqual(generateAll(ir));
  });

  it("matches every committed golden artifact byte-for-byte", async () => {
    const output = generateAll(await procurement());
    for (const [path, expected] of Object.entries(output)) {
      expect(await readFile(`generated/procurement/${path}`, "utf8"), path).toBe(expected);
    }
    const reservationOutput = generateAll(await reservations());
    for (const [path, expected] of Object.entries(reservationOutput)) {
      expect(await readFile(`generated/reservations/${path}`, "utf8"), `reservations/${path}`).toBe(expected);
    }
  });

  it("emits atomic half-open temporal exclusion enforcement", async () => {
    const output = generateAll(await reservations());
    const schema = output["postgres/002_schema.sql"];
    expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(schema).toContain('CHECK (("starts_at" < "ends_at") IS TRUE)');
    expect(schema).toContain("EXCLUDE USING gist");
    expect(schema).toContain("tstzrange(\"starts_at\", \"ends_at\", '[)')");
    expect(output["typescript/errors.ts"]).toContain('value?.code === "23P01"');
    expect(output["typescript/errors.ts"]).toContain("class ConflictError");
    expect(output["enforcement.md"]).toContain("exclusion:Reservation.no_overlapping_reservations");
    expect(output["model.mmd"]).toContain("Temporal exclusion: no_overlapping_reservations");
  });

  it("lowers null checks as IS NULL and never = NULL", () => {
    const source = `model M version "1";
      entity User { id: UUID @id; }
      entity Item { id: UUID @id; owner: User?; invariant owner_optional: owner == null or owner != null; }
      action make(caller actor: User, id: UUID) -> Item {
        authorize true;
        create Item { id = id; owner = null; }
      }`;
    const sql = generateAll(compileText(source, "null.model"))["postgres/002_schema.sql"];
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("IS NOT NULL");
    expect(sql).not.toMatch(/(?:=|<>) NULL/);
  });

  it("enforces exclusive lower bounds and only writes snapshots when an action assigns them", () => {
    const source = `model M version "1";
      enum Role { EMPLOYEE }
      entity User { id: UUID @id; role: Role; }
      entity Record { id: UUID @id; amount: Decimal @minExclusive(0); roleAtWrite: Role? @snapshot; }
      action make(caller actor: User, id: UUID, amount: Decimal) -> Record {
        authorize true;
        create Record { id = id; amount = amount; }
      }`;
    const output = generateAll(compileText(source, "exclusive.model"));
    expect(output["postgres/002_schema.sql"]).toContain('"amount" > 0');
    expect(output["postgres/002_schema.sql"]).toContain("ck_record_amount_min_exclusive");
    expect(output["postgres/003_actions.sql"]).not.toMatch(/INSERT INTO[\s\S]*?"role_at_write"[\s\S]*?VALUES/);
    expect(output["typescript/types.ts"]).toContain("Stored point-in-time snapshot");
  });

  it("never exposes an actor argument in SQL or TypeScript callable APIs", async () => {
    const output = generateAll(await procurement());
    const actions = output["postgres/003_actions.sql"];
    const queries = output["postgres/003_queries.sql"];
    const client = output["typescript/client.ts"];
    const types = output["typescript/types.ts"];
    expect(actions).not.toMatch(/"p_actor"/);
    expect(queries).not.toMatch(/"p_actor"/);
    expect(client).not.toMatch(/input\.actor|actor:/);
    expect(types).not.toMatch(/\n  actor:/);
    expect(actions).toContain("session_user");
    expect(queries).toContain("session_user");
    expect(actions).toContain('v_actor."id" = v_request."requester_id"');
  });

  it("emits safe privileged functions and an execute-only application boundary", async () => {
    const output = generateAll(await procurement());
    expect(output["postgres/003_actions.sql"]).toContain("SECURITY DEFINER");
    expect(output["postgres/003_actions.sql"]).toContain("SET search_path = pg_catalog, pg_temp");
    expect(output["postgres/003_actions.sql"]).not.toContain("EXECUTE ");
    expect(output["postgres/003_queries.sql"]).toContain("SECURITY DEFINER");
    expect(output["postgres/003_queries.sql"]).toContain("SET search_path = pg_catalog, pg_temp");
    expect(output["postgres/004_grants.sql"]).toContain('REVOKE ALL ON TABLE "model_procurement"."purchase_request"');
    expect(output["postgres/004_grants.sql"]).not.toContain("GRANT SELECT");
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement"."my_requests"()');
  });

  it("generates fail-closed, deterministic, bounded query SQL and typed clients", async () => {
    const output = generateAll(await procurement());
    const sql = output["postgres/003_queries.sql"];
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "model_procurement"."my_requests"()');
    expect(sql).toContain('WHERE (((v_row."requester_id" = v_actor."id")) IS TRUE)');
    expect(sql).toContain('ORDER BY v_row."id" ASC, v_row."id" ASC');
    expect(sql).toContain("LIMIT 100");
    expect(sql).not.toMatch(/FOR (?:UPDATE|NO KEY UPDATE)/);
    expect(output["typescript/types.ts"]).toContain("export interface MyRequestsInput");
    expect(output["typescript/types.ts"]).not.toMatch(/interface MyRequestsInput \{\n  actor:/);
    expect(output["typescript/client.ts"]).toContain("async myRequests(input: MyRequestsInput): Promise<PurchaseRequest[]>");
  });

  it("enforces enum sets and lowers membership and snapshot copies", async () => {
    const output = generateAll(await procurement());
    const schema = output["postgres/002_schema.sql"];
    const actions = output["postgres/003_actions.sql"];
    expect(schema).toContain('"roles" text[] NOT NULL');
    expect(schema).toContain('CONSTRAINT "ck_user_roles_enum_set"');
    expect(schema).toContain('"roles" <@ ARRAY[\'EMPLOYEE\', \'MANAGER\', \'FINANCE\']::text[]');
    expect(schema).toContain('array_position("roles", NULL::text) IS NULL');
    expect(schema).toContain("array_positions(\"roles\", 'MANAGER')");
    expect(actions).toContain("'EMPLOYEE' = ANY(v_actor.\"roles\")");
    expect(actions).toContain('"approved_by_roles" = v_actor."roles"');
    expect(output["typescript/types.ts"]).toContain("roles: Role[];");
    expect(output["typescript/types.ts"]).toContain("approvedByRoles: Role[] | null;");
    expect(output["enforcement.md"]).toContain("enum-set:User.roles");
  });

  it("explains identity, locks, invariants, guards, effects, and privilege boundaries", async () => {
    const markdown = generateAll(await procurement())["enforcement.md"];
    for (const expected of [
      "boundary:principal_binding",
      "invariant:PurchaseRequest.approval_fields_match_status",
      "snapshot:PurchaseRequest.approvedByRoles",
      "authorize:approveRequest",
      "require:approveRequest.is_submitted",
      "lock:approveRequest.request",
      "boundary:PurchaseRequest.direct_write",
      "boundary:PurchaseRequest.direct_read",
      "where:myRequests",
      "order:myRequests",
      "limit:myRequests",
      "read:myRequests",
      "boundary:audit",
    ]) expect(markdown).toContain(expected);
  });
});
