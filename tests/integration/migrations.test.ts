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

function source(version: string, entityName: string, fieldName: string): string {
  return `model RenameIntegration version "${version}";
entity User @stableId("${userEntity}") {
  id: UUID @id @stableId("${userIdField}");
}
entity ${entityName} @stableId("${orderEntity}") {
  id: UUID @id @stableId("${orderIdField}");
  ${fieldName}: User @stableId("${requesterField}");
}
action make(caller actor: User, id: UUID) -> ${entityName} {
  authorize true;
  create ${entityName} { id = id; ${fieldName} = actor; }
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

describe("ModelLang 0.5 PostgreSQL rename migration", () => {
  it("renames the existing table and column without losing data or its foreign key", async () => {
    const previous = compileText(source("1.0.0", "Purchase", "requestedBy"), "previous.model");
    const current = compileText(source("2.0.0", "PurchaseOrder", "requestor"), "current.model");
    const generated = generateAll(previous);
    const currentGenerated = generateAll(current);
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration_internal CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS model_rename_integration CASCADE");
    await admin.query(generated["postgres/001_roles.sql"]!);
    await admin.query(generated["postgres/002_schema.sql"]!);
    await admin.query(generated["postgres/003_actions.sql"]!);

    const userId = "90000000-0000-4000-8000-000000000001";
    const purchaseId = "90000000-0000-4000-8000-000000000002";
    await admin.query(`INSERT INTO model_rename_integration."user" (id) VALUES ($1)`, [userId]);
    await admin.query(
      "INSERT INTO model_rename_integration_internal.principal_binding (database_principal, principal_id) VALUES ('postgres', $1)",
      [userId],
    );
    await admin.query("INSERT INTO model_rename_integration.purchase (id, requested_by_id) VALUES ($1, $2)", [purchaseId, userId]);

    const plan = planMigration(previous, current);
    await admin.query(plan.sql);
    await admin.query(currentGenerated["postgres/003_actions.sql"]!);

    const preserved = await admin.query<{ id: string; requestor_id: string }>(
      "SELECT id, requestor_id FROM model_rename_integration.purchase_order WHERE id = $1",
      [purchaseId],
    );
    expect(preserved.rows).toEqual([{ id: purchaseId, requestor_id: userId }]);
    const createdId = "90000000-0000-4000-8000-000000000004";
    const created = await admin.query<{ value: { id: string; requestor: string } }>(
      "SELECT model_rename_integration.make($1) AS value",
      [createdId],
    );
    expect(created.rows[0]!.value).toEqual({ id: createdId, requestor: userId });
    await expect(admin.query(
      "INSERT INTO model_rename_integration.purchase_order (id, requestor_id) VALUES ($1, $2)",
      ["90000000-0000-4000-8000-000000000003", "90000000-0000-4000-8000-000000000099"],
    )).rejects.toMatchObject({ code: "23503" });
  });
});
