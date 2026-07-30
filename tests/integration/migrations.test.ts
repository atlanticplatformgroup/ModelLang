import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAll } from "../../src/build.js";
import { compileText } from "../../src/compiler.js";
import { planMigration } from "../../src/migrations.js";
import { databaseUrl } from "../../scripts/database.js";

const userEntity = "ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const orderEntity = "ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const userIdField = "fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const orderIdField = "fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const requesterField = "fld_cccccccccccccccccccccccccccccccc";
const makeAction = "act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const identityInvariant = "inv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ordersQuery = "qry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function source(
  version: string,
  entityName: string,
  fieldName: string,
  actionName: string,
  invariantName: string,
  queryName: string,
): string {
  return `model RenameIntegration version "${version}";
entity User @stableId("${userEntity}") {
  id: UUID @id @stableId("${userIdField}");
}
entity ${entityName} @stableId("${orderEntity}") {
  id: UUID @id @stableId("${orderIdField}");
  ${fieldName}: User @stableId("${requesterField}");
  invariant ${invariantName} @stableId("${identityInvariant}"): id == id;
}
action ${actionName} @stableId("${makeAction}")(caller actor: User, id: UUID) -> ${entityName} {
  authorize true;
  create ${entityName} { id = id; ${fieldName} = actor; }
}
query ${queryName} @stableId("${ordersQuery}")(caller actor: User) from ${entityName} as row {
  authorize true;
  where row.${fieldName} == actor;
  orderBy row.id asc;
  limit 100;
}`;
}

let admin: Pool;

beforeAll(() => {
  admin = new Pool({ connectionString: databaseUrl });
});

afterAll(async () => {
  if (admin) {
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration_internal CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration CASCADE");
    await admin.end();
  }
});

describe("ModelLang 0.6 PostgreSQL rename migration", () => {
  it("renames stored declarations and generated functions without losing data or enforcement", async () => {
    const previous = compileText(source("1.0.0", "Purchase", "requestedBy", "make", "has_identity", "my_purchases"), "previous.model");
    const current = compileText(source("2.0.0", "PurchaseOrder", "requestor", "createOrder", "identity_present", "my_orders"), "current.model");
    const generated = generateAll(previous);
    const currentGenerated = generateAll(current);
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration_internal CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration CASCADE");
    await admin.query(generated["postgres/001_roles.sql"]!);
    await admin.query(generated["postgres/002_schema.sql"]!);
    await admin.query(generated["postgres/003_actions.sql"]!);
    await admin.query(generated["postgres/003_queries.sql"]!);

    const userId = "90000000-0000-4000-8000-000000000001";
    const purchaseId = "90000000-0000-4000-8000-000000000002";
    await admin.query(`INSERT INTO model_rename_integration."user" (id) VALUES ($1)`, [userId]);
    await admin.query(
      "INSERT INTO model_rename_integration_internal.principal_binding (database_principal, principal_id) VALUES ('postgres', $1)",
      [userId],
    );
    await admin.query("SELECT model_rename_integration.make($1)", [purchaseId]);

    const plan = planMigration(previous, current);
    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "renameEntity",
      "renameField",
      "renameInvariant",
      "renameAction",
      "renameQuery",
    ]);
    await admin.query(plan.sql);
    await admin.query(currentGenerated["postgres/003_actions.sql"]!);
    await admin.query(currentGenerated["postgres/003_queries.sql"]!);

    const preserved = await admin.query<{ id: string; requestor_id: string }>(
      "SELECT id, requestor_id FROM model_rename_integration.purchase_order WHERE id = $1",
      [purchaseId],
    );
    expect(preserved.rows).toEqual([{ id: purchaseId, requestor_id: userId }]);
    const createdId = "90000000-0000-4000-8000-000000000004";
    const created = await admin.query<{ value: { id: string; requestor: string } }>(
      "SELECT model_rename_integration.create_order($1) AS value",
      [createdId],
    );
    expect(created.rows[0]!.value).toEqual({ id: createdId, requestor: userId });
    const audit = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM model_rename_integration_internal.action_audit
       WHERE action_id = $1`,
      [`action:${makeAction}`],
    );
    expect(audit.rows[0]!.count).toBe("2");
    const listed = await admin.query<{ value: { id: string; requestor: string }[] }>(
      "SELECT model_rename_integration.my_orders() AS value",
    );
    expect(listed.rows.map((row) => row.value).flat()).toEqual([
      { id: purchaseId, requestor: userId },
      { id: createdId, requestor: userId },
    ]);
    await expect(admin.query("SELECT model_rename_integration.make($1)", [createdId])).rejects.toMatchObject({ code: "42883" });
    await expect(admin.query("SELECT model_rename_integration.my_purchases()")).rejects.toMatchObject({ code: "42883" });
    await expect(admin.query(
      "INSERT INTO model_rename_integration.purchase_order (id, requestor_id) VALUES ($1, $2)",
      ["90000000-0000-4000-8000-000000000003", "90000000-0000-4000-8000-000000000099"],
    )).rejects.toMatchObject({ code: "23503" });
  });
});
