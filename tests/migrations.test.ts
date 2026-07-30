import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { ModelError } from "../src/diagnostics.js";
import { planMigration } from "../src/migrations.js";
import { assignStableIds, type StableIdKind } from "../src/stable-ids.js";

const entityUser = "ent_11111111111111111111111111111111";
const entityPurchase = "ent_22222222222222222222222222222222";
const fieldUserId = "fld_11111111111111111111111111111111";
const fieldPurchaseId = "fld_22222222222222222222222222222222";
const fieldRequester = "fld_33333333333333333333333333333333";

function renameModel(options: {
  version: string;
  entityName?: string;
  fieldName?: string;
  fieldType?: string;
  fieldOptional?: boolean;
  extraField?: string;
}): string {
  const entityName = options.entityName ?? "Purchase";
  const fieldName = options.fieldName ?? "requestedBy";
  return `model RenameProof version "${options.version}";
entity User @stableId("${entityUser}") {
  id: UUID @id @stableId("${fieldUserId}");
}
entity ${entityName} @stableId("${entityPurchase}") {
  id: UUID @id @stableId("${fieldPurchaseId}");
  ${fieldName}: ${options.fieldType ?? "User"}${options.fieldOptional ? "?" : ""} @stableId("${fieldRequester}");
  ${options.extraField ?? ""}
}
action make(caller actor: User, id: UUID) -> ${entityName} {
  authorize true;
  create ${entityName} {
    id = id;
    ${fieldName} = actor;
  }
}`;
}

function error(operation: () => unknown): ModelError {
  try {
    operation();
  } catch (caught) {
    expect(caught).toBeInstanceOf(ModelError);
    return caught as ModelError;
  }
  throw new Error("Expected ModelError");
}

describe("ModelLang 0.5 stable IDs", () => {
  it("assigns only missing entity and field IDs and is idempotent", () => {
    const source = `model IDs version "1";
entity User {
  id: UUID @id;
  name: String;
}
action make(caller actor: User, id: UUID) -> User {
  authorize true;
  create User { id = id; name = "created"; }
}`;
    const ids = [
      "ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "fld_cccccccccccccccccccccccccccccccc",
    ];
    const assigned = assignStableIds(source, "ids.model", (_kind: StableIdKind) => ids.shift()!);
    expect(assigned.assigned).toBe(3);
    expect(assigned.source).toContain('entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")');
    expect(assigned.source).toContain('id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");');
    expect(assigned.source).toContain('name: String @stableId("fld_cccccccccccccccccccccccccccccccc");');
    const repeated = assignStableIds(assigned.source, "ids.model", () => {
      throw new Error("ID factory should not be called");
    });
    expect(repeated).toEqual({ source: assigned.source, assigned: 0 });

    const ir = compileText(assigned.source, "ids.model");
    expect(ir.entities[0]).toMatchObject({
      id: "entity:ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "User",
      identity: { strategy: "explicitStableId", stableId: "ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    expect(ir.entities[0]!.fields[0]).toMatchObject({
      id: "field:fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      identity: { strategy: "explicitStableId" },
    });
  });

  it.each([
    ["invalid entity ID", `entity User @stableId("bad") { id: UUID @id @stableId("${fieldUserId}"); }`, "E2801"],
    ["invalid field ID", `entity User @stableId("${entityUser}") { id: UUID @id @stableId("bad"); }`, "E2801"],
    ["duplicate ID", `entity User @stableId("${entityUser}") { id: UUID @id @stableId("${fieldUserId}"); name: String @stableId("${fieldUserId}"); }`, "E2802"],
  ])("rejects %s", (_name, entity, code) => {
    const source = `model Invalid version "1"; ${entity}
      action a(caller actor: User) -> User { authorize true; update actor { id = actor.id; } }`;
    expect(error(() => compileText(source)).code).toBe(code);
  });
});

describe("ModelLang 0.5 rename migration planning", () => {
  it("matches by ID and emits deterministic entity and field renames", () => {
    const previous = compileText(renameModel({ version: "1.0.0" }), "previous.model");
    const current = compileText(renameModel({
      version: "2.0.0",
      entityName: "PurchaseOrder",
      fieldName: "requestor",
    }), "current.model");
    const plan = planMigration(previous, current);
    expect(plan.operations).toEqual([
      {
        kind: "renameEntity",
        entityId: `entity:${entityPurchase}`,
        from: "purchase",
        to: "purchase_order",
      },
      {
        kind: "renameField",
        entityId: `entity:${entityPurchase}`,
        fieldId: `field:${fieldRequester}`,
        table: "purchase_order",
        from: "requested_by_id",
        to: "requestor_id",
      },
    ]);
    expect(plan.sql).toBe(`-- ModelLang rename migration 1.0.0 -> 2.0.0
BEGIN;
ALTER TABLE "model_rename_proof"."purchase" RENAME TO "purchase_order";
ALTER TABLE "model_rename_proof"."purchase_order" RENAME COLUMN "requested_by_id" TO "requestor_id";
COMMIT;
-- Next apply the current generated 003_actions.sql, 003_queries.sql, and 004_grants.sql.
`);
    expect(planMigration(previous, current)).toEqual(plan);
  });

  it("refuses name-derived, additive, and structural changes", () => {
    const previous = compileText(renameModel({ version: "1" }));
    const derived = compileText(`model Derived version "2";
      entity User { id: UUID @id; name: String; }
      action a(caller actor: User, id: UUID) -> User { authorize true; create User { id = id; name = "created"; } }`);
    expect(error(() => planMigration(derived, derived)).code).toBe("E2804");

    const added = compileText(renameModel({
      version: "2",
      extraField: `note: String? @stableId("fld_44444444444444444444444444444444");`,
    }));
    expect(error(() => planMigration(previous, added)).code).toBe("E2805");

    const changed = compileText(renameModel({ version: "2", fieldOptional: true }));
    expect(error(() => planMigration(previous, changed)).code).toBe("E2807");
  });
});
