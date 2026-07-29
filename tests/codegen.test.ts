import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { generateAll } from "../src/build.js";

async function procurement() {
  const source = await readFile("examples/procurement.model", "utf8");
  return compileText(source, "examples/procurement.model");
}

describe("backends", () => {
  it("generates deterministic output from IR only", async () => {
    const ir = await procurement();
    expect(generateAll(ir)).toEqual(generateAll(ir));
  });

  it("matches every committed golden artifact byte-for-byte", async () => {
    const output = generateAll(await procurement());
    for (const [path, expected] of Object.entries(output)) {
      expect(await readFile(`generated/${path}`, "utf8"), path).toBe(expected);
    }
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
    const client = output["typescript/client.ts"];
    const types = output["typescript/types.ts"];
    expect(actions).not.toMatch(/"p_actor"/);
    expect(client).not.toMatch(/input\.actor|actor:/);
    expect(types).not.toMatch(/\n  actor:/);
    expect(actions).toContain("session_user");
    expect(actions).toContain('v_actor."id" = v_request."requester_id"');
  });

  it("emits safe privileged functions and restricted grants", async () => {
    const output = generateAll(await procurement());
    expect(output["postgres/003_actions.sql"]).toContain("SECURITY DEFINER");
    expect(output["postgres/003_actions.sql"]).toContain("SET search_path = pg_catalog, pg_temp");
    expect(output["postgres/003_actions.sql"]).not.toContain("EXECUTE ");
    expect(output["postgres/004_grants.sql"]).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE");
  });

  it("explains identity, locks, invariants, guards, effects, and privilege boundaries", async () => {
    const markdown = generateAll(await procurement())["enforcement.md"];
    for (const expected of [
      "boundary:principal_binding",
      "invariant:PurchaseRequest.approval_fields_match_status",
      "snapshot:PurchaseRequest.approvedByRole",
      "authorize:approveRequest",
      "require:approveRequest.is_submitted",
      "lock:approveRequest.request",
      "boundary:PurchaseRequest.direct_write",
      "boundary:audit",
    ]) expect(markdown).toContain(expected);
  });
});
