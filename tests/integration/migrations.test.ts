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
projection OrderSummary @stableId("prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") from ${entityName} {
  id @stableId("pfd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
query ${queryName} @stableId("${ordersQuery}")(caller actor: User) returns OrderSummary from ${entityName} as row {
  authorize true;
  where row.${fieldName} == actor;
  orderBy row.id asc;
  limit 100;
}`;
}

function evolutionSource(version: string, expanded: boolean): string {
  return `model EvolutionIntegration version "${version}";
enum Status @stableId("enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  DRAFT @stableId("emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")${expanded ? `,
  SUBMITTED @stableId("emv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")` : ""}
}
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
entity Ticket @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");
  ${expanded ? `note: String? @stableId("fld_dddddddddddddddddddddddddddddddd");
  priority: Int = 0 @min(0) @stableId("fld_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");` : ""}
}
${expanded ? `entity Comment @stableId("ent_cccccccccccccccccccccccccccccccc") {
  id: UUID @id @stableId("fld_11111111111111111111111111111111");
  ticket: Ticket @stableId("fld_22222222222222222222222222222222");
  body: String @stableId("fld_33333333333333333333333333333333");
}
` : ""}
action open @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> Ticket {
  authorize true;
  create Ticket { id = id; status = Status.DRAFT; }
}
${expanded ? `action submit @stableId("act_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")(caller actor: User, ticket: Ticket) -> Ticket {
  authorize true;
  require is_draft: ticket.status == Status.DRAFT;
  update ticket { status = Status.SUBMITTED; }
}
action comment @stableId("act_cccccccccccccccccccccccccccccccc")(
  caller actor: User, id: UUID, ticket: Ticket, body: String
) -> Comment {
  authorize true;
  create Comment { id = id; ticket = ticket; body = body; }
}
projection TicketSummary @stableId("prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") from Ticket {
  id @stableId("pfd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
query submitted @stableId("qry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User) returns TicketSummary from Ticket as ticket {
  authorize true;
  where ticket.status == Status.SUBMITTED;
  orderBy ticket.id asc;
  limit 100;
}
` : ""}
workflow TicketLifecycle @stableId("wfl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") for Ticket.status {
  initial Status.DRAFT;
  ${expanded ? `transition submit @stableId("trn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"):
    Status.DRAFT -> Status.SUBMITTED by submit;` : ""}
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
    await admin.query("DROP SCHEMA IF EXISTS model_evolution_integration_internal CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS model_evolution_integration CASCADE");
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
      { id: purchaseId },
      { id: createdId },
    ]);
    await expect(admin.query("SELECT model_rename_integration.make($1)", [createdId])).rejects.toMatchObject({ code: "42883" });
    await expect(admin.query("SELECT model_rename_integration.my_purchases()")).rejects.toMatchObject({ code: "42883" });
    await expect(admin.query(
      "INSERT INTO model_rename_integration.purchase_order (id, requestor_id) VALUES ($1, $2)",
      ["90000000-0000-4000-8000-000000000003", "90000000-0000-4000-8000-000000000099"],
    )).rejects.toMatchObject({ code: "23503" });
  });
});

describe("ModelLang 0.10 PostgreSQL safe evolution", () => {
  it("preserves rows while adding fields, entities, callables, enum values, workflow edges, and history", async () => {
    const previous = compileText(evolutionSource("1.0.0", false), "evolution-v1.model");
    const current = compileText(evolutionSource("2.0.0", true), "evolution-v2.model");
    const generated = generateAll(previous);
    await admin.query("DROP SCHEMA IF EXISTS model_evolution_integration_internal CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS model_evolution_integration CASCADE");
    await admin.query(generated["postgres/001_roles.sql"]!);
    await admin.query(generated["postgres/002_schema.sql"]!);
    await admin.query(generated["postgres/003_actions.sql"]!);
    await admin.query(generated["postgres/003_queries.sql"]!);

    const userId = "91000000-0000-4000-8000-000000000001";
    const ticketId = "91000000-0000-4000-8000-000000000002";
    const commentId = "91000000-0000-4000-8000-000000000003";
    await admin.query(`INSERT INTO model_evolution_integration."user" (id) VALUES ($1)`, [userId]);
    await admin.query(
      "INSERT INTO model_evolution_integration_internal.principal_binding (database_principal, principal_id) VALUES ('postgres', $1)",
      [userId],
    );
    await admin.query("SELECT model_evolution_integration.open($1)", [ticketId]);

    // Simulate the internal boundary of a released 0.11 installation. The 0.12
    // migration must add gateway infrastructure independently of model DDL.
    await admin.query(`
      DROP FUNCTION model_evolution_integration_internal.bind_gateway_identity(text, text);
      DROP FUNCTION model_evolution_integration_internal.resolve_principal();
      DROP TABLE model_evolution_integration_internal.gateway_principal_binding;
      ALTER TABLE model_evolution_integration_internal.action_audit
        DROP CONSTRAINT ck_action_audit_gateway_identity,
        DROP COLUMN identity_issuer,
        DROP COLUMN identity_subject;
    `);

    const plan = planMigration(previous, current);
    await admin.query(plan.sql);

    const gatewayBoundary = await admin.query<{ gateway_table: string; issuer_column: string }>(`
      SELECT
        pg_catalog.to_regclass('model_evolution_integration_internal.gateway_principal_binding')::text AS gateway_table,
        (
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'model_evolution_integration_internal'
            AND table_name = 'action_audit'
            AND column_name = 'identity_issuer'
        ) AS issuer_column
    `);
    expect(gatewayBoundary.rows).toEqual([{
      gateway_table: "model_evolution_integration_internal.gateway_principal_binding",
      issuer_column: "identity_issuer",
    }]);

    const preserved = await admin.query<{ id: string; status: string; note: string | null; priority: string }>(
      "SELECT id, status, note, priority::text FROM model_evolution_integration.ticket WHERE id = $1",
      [ticketId],
    );
    expect(preserved.rows).toEqual([{ id: ticketId, status: "DRAFT", note: null, priority: "0" }]);

    const submitted = await admin.query<{ value: { id: string; status: string; priority: number } }>(
      "SELECT model_evolution_integration.submit($1) AS value",
      [ticketId],
    );
    expect(submitted.rows[0]!.value).toMatchObject({ id: ticketId, status: "SUBMITTED", priority: 0 });
    const comment = await admin.query<{ value: { id: string; ticket: string; body: string } }>(
      "SELECT model_evolution_integration.comment($1, $2, $3) AS value",
      [commentId, ticketId, "preserved"],
    );
    expect(comment.rows[0]!.value).toEqual({ id: commentId, ticket: ticketId, body: "preserved" });
    const listed = await admin.query<{ value: { id: string; status: string }[] }>(
      "SELECT model_evolution_integration.submitted() AS value",
    );
    expect(listed.rows[0]!.value).toEqual([{ id: ticketId }]);

    const history = await admin.query<{ version: string; source_hash: string }>(
      `SELECT version, source_hash
       FROM model_evolution_integration_internal.schema_migrations
       ORDER BY id`,
    );
    expect(history.rows).toEqual([
      { version: "1.0.0", source_hash: previous.model.sourceHash },
      { version: "2.0.0", source_hash: current.model.sourceHash },
    ]);
    await expect(admin.query(plan.sql)).rejects.toMatchObject({
      code: "55000",
      message: expect.stringContaining("ML_MIGRATION_BASELINE:"),
    });
  });
});
