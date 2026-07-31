import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAll } from "../../src/build.js";
import { compileText } from "../../src/compiler.js";
import {
  planReviewedMigration,
  REVIEWED_MIGRATION_SCHEMA,
  type ReviewedMigrationPlanDocument,
} from "../../src/reviewed-migrations.js";
import { semanticDiff } from "../../src/semantic-diff.js";
import { databaseUrl } from "../../scripts/database.js";

const ids = {
  status: "enm_26262626262626262626262626262626",
  draft: "emv_26262626262626262626262626262626",
  legacy: "emv_27272727272727272727272727272727",
  active: "emv_28282828282828282828282828282828",
  user: "ent_26262626262626262626262626262626",
  userId: "fld_26262626262626262626262626262626",
  request: "ent_27272727272727272727272727272727",
  requestId: "fld_27272727272727272727272727272727",
  statusField: "fld_28282828282828282828282828282828",
  legacyField: "fld_29292929292929292929292929292929",
  category: "fld_30303030303030303030303030303030",
  invariant: "inv_26262626262626262626262626262626",
  open: "act_26262626262626262626262626262626",
};

function source(version: string, current: boolean): string {
  return `model ProcurementReviewedIntegration version "${version}";
enum Status @stableId("${ids.status}") {
  DRAFT @stableId("${ids.draft}"),
  ${current ? `ACTIVE @stableId("${ids.active}")` : `LEGACY @stableId("${ids.legacy}")`}
}
entity User @stableId("${ids.user}") {
  id: UUID @id @stableId("${ids.userId}");
}
entity PurchaseRequest @stableId("${ids.request}") {
  id: UUID @id @stableId("${ids.requestId}");
  status: Status = Status.${current ? "ACTIVE" : "LEGACY"} @stableId("${ids.statusField}");
  ${current
    ? `category: String @stableId("${ids.category}");
  invariant category_present @stableId("${ids.invariant}"): category != "";`
    : `legacyCode: String @stableId("${ids.legacyField}");`}
}
action openRequest @stableId("${ids.open}")(caller actor: User, id: UUID) -> PurchaseRequest {
  authorize true;
  create PurchaseRequest {
    id = id;
    status = Status.${current ? "ACTIVE" : "LEGACY"};
    ${current ? `category = "GENERAL";` : `legacyCode = "legacy";`}
  }
}`;
}

function planDocument(
  previous: ReturnType<typeof compileText>,
  current: ReturnType<typeof compileText>,
  category: string,
): ReviewedMigrationPlanDocument {
  return {
    $schema: REVIEWED_MIGRATION_SCHEMA,
    planVersion: 1,
    strategy: "transactionalRebuild",
    description: "Procurement 0.16 reviewed data evolution proof.",
    from: { modelId: previous.model.id, version: previous.model.version, sourceHash: previous.model.sourceHash },
    to: { modelId: current.model.id, version: current.model.version, sourceHash: current.model.sourceHash },
    acknowledgements: semanticDiff(previous, current).changes
      .filter((change) => change.classification !== "additive")
      .map((change) => ({
        changeKind: change.kind,
        subjectId: change.subject.id,
        disposition: change.kind === "declarationRemoved"
          ? change.subject.id === `enumMember:${ids.legacy}` ? "transformed" : "dataLossAccepted"
          : "accepted",
        reason: "Approved for the bounded Procurement migration fixture.",
      })),
    fieldValues: [{ targetFieldId: `field:${ids.category}`, source: { kind: "literal", value: category } }],
    enumMappings: [{
      enumId: `enum:${ids.status}`,
      members: [{ fromMemberId: `enumMember:${ids.legacy}`, toMemberId: `enumMember:${ids.active}` }],
    }],
  };
}

let admin: Pool;
const schema = "model_procurement_reviewed_integration";
const internal = `${schema}_internal`;
const dependentSchema = `${schema}_consumer`;

beforeAll(() => { admin = new Pool({ connectionString: databaseUrl }); });

afterAll(async () => {
  if (!admin) return;
  await admin.query(`DROP SCHEMA IF EXISTS "${dependentSchema}" CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS "${internal}" CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
});

describe("ModelLang 0.16 reviewed PostgreSQL migration", () => {
  it("validates before replacement, rolls back failure, and records the accepted plan hash", async () => {
    const previous = compileText(source("1.0.0", false), "procurement-before.model");
    const current = compileText(source("2.0.0", true), "procurement-after.model");
    const generated = generateAll(previous);
    await admin.query(`DROP SCHEMA IF EXISTS "${internal}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(generated["postgres/001_roles.sql"]!);
    await admin.query(generated["postgres/002_schema.sql"]!);
    await admin.query(generated["postgres/003_actions.sql"]!);
    await admin.query(generated["postgres/003_queries.sql"]!);
    await admin.query(generated["postgres/004_grants.sql"]!);

    const userId = "26000000-0000-4000-8000-000000000001";
    const requestId = "27000000-0000-4000-8000-000000000001";
    await admin.query(`INSERT INTO "${schema}"."user" (id) VALUES ($1)`, [userId]);
    await admin.query(`INSERT INTO "${schema}"."purchase_request" (id, status, legacy_code) VALUES ($1, 'LEGACY', 'retire-me')`, [requestId]);
    await admin.query(`INSERT INTO "${internal}"."principal_binding" (database_principal, principal_id) VALUES (current_user, $1)`, [userId]);

    const invalid = planReviewedMigration(previous, current, planDocument(previous, current, ""));
    await expect(admin.query(invalid.sql)).rejects.toMatchObject({ code: "23514" });
    const preserved = await admin.query(`SELECT status, legacy_code FROM "${schema}"."purchase_request" WHERE id = $1`, [requestId]);
    expect(preserved.rows).toEqual([{ status: "LEGACY", legacy_code: "retire-me" }]);
    expect((await admin.query(`SELECT version FROM "${internal}"."schema_migrations" ORDER BY id`)).rows).toEqual([{ version: "1.0.0" }]);

    const accepted = planReviewedMigration(previous, current, planDocument(previous, current, "GENERAL"));
    await admin.query(`CREATE SCHEMA "${dependentSchema}"`);
    await admin.query(`CREATE VIEW "${dependentSchema}"."request_ids" AS SELECT id FROM "${schema}"."purchase_request"`);
    await expect(admin.query(accepted.sql)).rejects.toMatchObject({ code: "2BP01" });
    expect((await admin.query(`SELECT id FROM "${dependentSchema}"."request_ids"`)).rows).toEqual([{ id: requestId }]);
    await admin.query(`DROP SCHEMA "${dependentSchema}" CASCADE`);
    await admin.query(accepted.sql);
    const migrated = await admin.query(`SELECT status, category FROM "${schema}"."purchase_request" WHERE id = $1`, [requestId]);
    expect(migrated.rows).toEqual([{ status: "ACTIVE", category: "GENERAL" }]);
    const columns = await admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'purchase_request' ORDER BY ordinal_position",
      [schema],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["id", "status", "category"]);
    const history = await admin.query(`SELECT version, migration_kind, plan_hash FROM "${internal}"."schema_migrations" ORDER BY id`);
    expect(history.rows).toEqual([
      { version: "1.0.0", migration_kind: "installation", plan_hash: null },
      { version: "2.0.0", migration_kind: "reviewed", plan_hash: accepted.planHash },
    ]);

    const createdId = "27000000-0000-4000-8000-000000000002";
    const created = await admin.query(`SELECT "${schema}"."open_request"($1) AS value`, [createdId]);
    expect(created.rows[0].value).toMatchObject({ id: createdId, status: "ACTIVE", category: "GENERAL" });
    await expect(admin.query(accepted.sql)).rejects.toMatchObject({ code: "55000" });
  });
});
