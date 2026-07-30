import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { ModelError } from "../src/diagnostics.js";
import { planMigration } from "../src/migrations.js";
import { assignStableIds, type StableIdKind } from "../src/stable-ids.js";
import { validateIR } from "../src/validate-ir.js";

const entityUser = "ent_11111111111111111111111111111111";
const entityPurchase = "ent_22222222222222222222222222222222";
const fieldUserId = "fld_11111111111111111111111111111111";
const fieldPurchaseId = "fld_22222222222222222222222222222222";
const fieldRequester = "fld_33333333333333333333333333333333";
const actionMake = "act_11111111111111111111111111111111";

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
action make @stableId("${actionMake}")(caller actor: User, id: UUID) -> ${entityName} {
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

describe("ModelLang 0.6 stable IDs", () => {
  it("assigns every missing durable declaration ID and is idempotent", () => {
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
      "act_dddddddddddddddddddddddddddddddd",
    ];
    const assigned = assignStableIds(source, "ids.model", (_kind: StableIdKind) => ids.shift()!);
    expect(assigned.assigned).toBe(4);
    expect(assigned.source).toContain('entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")');
    expect(assigned.source).toContain('id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");');
    expect(assigned.source).toContain('name: String @stableId("fld_cccccccccccccccccccccccccccccccc");');
    expect(assigned.source).toContain('action make @stableId("act_dddddddddddddddddddddddddddddddd")');
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

  it("assigns IDs to enums, enum members, invariants, exclusions, actions, and queries", () => {
    const source = `model CompleteIds version "1";
enum State { OPEN, CLOSED }
entity User { id: UUID @id; }
entity Resource { id: UUID @id; }
entity Booking {
  id: UUID @id;
  resource: Resource;
  startsAt: DateTime;
  endsAt: DateTime;
  state: State;
  invariant valid_interval: startsAt < endsAt;
  exclusion no_overlap: noOverlap(resource, startsAt, endsAt);
}
action reserve(caller actor: User, id: UUID, resource: Resource, startsAt: DateTime, endsAt: DateTime) -> Booking {
  authorize true;
  create Booking { id = id; resource = resource; startsAt = startsAt; endsAt = endsAt; state = State.OPEN; }
}
query bookings(caller actor: User) from Booking as booking {
  authorize true;
  where true;
  orderBy booking.id asc;
  limit 10;
}`;
    const seen: StableIdKind[] = [];
    const counters = new Map<StableIdKind, number>();
    const prefixes: Record<StableIdKind, string> = {
      entity: "ent", field: "fld", enum: "enm", enumMember: "emv",
      action: "act", query: "qry", invariant: "inv", exclusion: "exc",
    };
    const assigned = assignStableIds(source, "complete.model", (kind) => {
      seen.push(kind);
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${prefixes[kind]}_${next.toString(16).padStart(32, "0")}`;
    });
    expect(new Set(seen)).toEqual(new Set<StableIdKind>([
      "enum", "enumMember", "entity", "field", "invariant", "exclusion", "action", "query",
    ]));
    expect(compileText(assigned.source, "complete.model").irVersion).toBe(7);
    expect(assignStableIds(assigned.source, "complete.model").assigned).toBe(0);
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

  it.each([
    ["enum", `enum E @stableId("bad") { A } entity User { id: UUID @id; }`],
    ["enum member", `enum E { A @stableId("bad") } entity User { id: UUID @id; }`],
    ["invariant", `entity User { id: UUID @id; invariant valid @stableId("bad"): id == id; }`],
    ["exclusion", `entity User { id: UUID @id; } entity Resource { id: UUID @id; } entity Slot { id: UUID @id; resource: Resource; starts: DateTime; ends: DateTime; exclusion no_overlap @stableId("bad"): noOverlap(resource, starts, ends); }`],
    ["action", `entity User { id: UUID @id; } action make @stableId("bad")(caller actor: User, id: UUID) -> User { authorize true; create User { id = id; } }`],
    ["query", `entity User { id: UUID @id; } query users @stableId("bad")(caller actor: User) from User as user { authorize true; where true; orderBy user.id asc; limit 10; }`],
  ])("rejects an invalid %s stable ID", (_name, declaration) => {
    const source = `model InvalidStableId version "1"; ${declaration}
      action establish(caller actor: User, id: UUID) -> User { authorize true; create User { id = id; } }`;
    expect(error(() => compileText(source)).code).toBe("E2801");
  });
});

describe("ModelLang 0.6 identity-based IR", () => {
  it("uses semantic enum, member, action, query, invariant, and exclusion IDs in references", () => {
    const source = `model IdentityProof version "1";
enum State @stableId("enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  OPEN @stableId("emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  CLOSED @stableId("emv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
}
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  state: State @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  invariant valid_state @stableId("inv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"): state == State.OPEN or state == State.CLOSED;
}
action change @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> User {
  authorize actor.state == State.OPEN;
  create User { id = id; state = State.CLOSED; }
}
query users @stableId("qry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User) from User as user {
  authorize true;
  where user.state == State.OPEN;
  orderBy user.id asc;
  limit 10;
}`;
    const ir = compileText(source, "identity.model");
    expect(ir.enums[0]).toMatchObject({
      id: "enum:enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      identity: { strategy: "explicitStableId" },
      members: [
        { id: "enumMember:emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { id: "enumMember:emv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      ],
    });
    expect(ir.entities[0]!.fields[1]!.type).toBe("enum:enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ir.entities[0]!.invariants[0]!.id).toBe("invariant:inv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ir.actions[0]!.id).toBe("action:act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ir.queries[0]!.id).toBe("query:qry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ir.actions[0]!.authorization.expression).toMatchObject({
      right: {
        kind: "enumLiteral",
        enumId: "enum:enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        memberId: "enumMember:emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    const renamed = compileText(source.replaceAll("State", "Lifecycle"), "identity-renamed.model");
    expect(renamed.entities[0]!.fields[1]!.type).toBe(ir.entities[0]!.fields[1]!.type);
    expect(planMigration(ir, renamed).operations).toEqual([{
      kind: "renameEnum",
      enumId: "enum:enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "State",
      to: "Lifecycle",
    }]);
  });

  it("rejects an externally supplied IR v6 declaration without identity metadata", () => {
    const malformed = structuredClone(compileText(renameModel({ version: "1" })));
    delete (malformed.actions[0] as { identity?: unknown }).identity;
    expect(error(() => validateIR(malformed)).code).toBe("E3002");
  });
});

describe("ModelLang 0.6 rename migration planning", () => {
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

  it("renames stable enums, constraints, actions, and queries without name matching", () => {
    const source = (names: {
      enumName: string;
      entityName: string;
      startField: string;
      invariantName: string;
      exclusionName: string;
      actionName: string;
      queryName: string;
      version: string;
    }) => `model BroadRename version "${names.version}";
enum ${names.enumName} @stableId("enm_11111111111111111111111111111111") {
  ACTIVE @stableId("emv_11111111111111111111111111111111")
}
entity User @stableId("ent_11111111111111111111111111111111") {
  id: UUID @id @stableId("fld_11111111111111111111111111111111");
}
entity Resource @stableId("ent_22222222222222222222222222222222") {
  id: UUID @id @stableId("fld_22222222222222222222222222222222");
}
entity ${names.entityName} @stableId("ent_33333333333333333333333333333333") {
  id: UUID @id @stableId("fld_33333333333333333333333333333333");
  resource: Resource @stableId("fld_44444444444444444444444444444444");
  ${names.startField}: DateTime @stableId("fld_55555555555555555555555555555555");
  endsAt: DateTime @stableId("fld_66666666666666666666666666666666");
  invariant ${names.invariantName} @stableId("inv_11111111111111111111111111111111"): ${names.startField} < endsAt;
  exclusion ${names.exclusionName} @stableId("exc_11111111111111111111111111111111"): noOverlap(resource, ${names.startField}, endsAt);
}
action ${names.actionName} @stableId("act_11111111111111111111111111111111")(
  caller actor: User, id: UUID, resource: Resource, startsAt: DateTime, endsAt: DateTime
) -> ${names.entityName} {
  authorize true;
  create ${names.entityName} { id = id; resource = resource; ${names.startField} = startsAt; endsAt = endsAt; }
}
query ${names.queryName} @stableId("qry_11111111111111111111111111111111")(
  caller actor: User, resource: Resource
) from ${names.entityName} as row {
  authorize true;
  where row.resource == resource;
  orderBy row.${names.startField} asc;
  limit 10;
}`;
    const previous = compileText(source({
      enumName: "State",
      entityName: "Reservation",
      startField: "startsAt",
      invariantName: "valid_interval",
      exclusionName: "no_overlap",
      actionName: "reserve",
      queryName: "reservations",
      version: "1",
    }));
    const current = compileText(source({
      enumName: "Lifecycle",
      entityName: "Booking",
      startField: "beginsAt",
      invariantName: "valid_window",
      exclusionName: "no_conflicts",
      actionName: "book",
      queryName: "bookings",
      version: "2",
    }));
    const plan = planMigration(previous, current);
    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "renameEnum",
      "renameEntity",
      "renameField",
      "renameInvariant",
      "renameExclusion",
      "renameAction",
      "renameQuery",
    ]);
    expect(plan.sql).toContain("-- Semantic enum rename State -> Lifecycle; stored values are unchanged.");
    expect(plan.sql).toContain('ALTER TABLE "model_broad_rename"."reservation" RENAME TO "booking";');
    expect(plan.sql).toContain('ALTER TABLE "model_broad_rename"."booking" RENAME COLUMN "starts_at" TO "begins_at";');
    expect(plan.sql).toContain('RENAME CONSTRAINT "ck_reservation_valid_interval" TO "ck_booking_valid_window";');
    expect(plan.sql).toContain('ALTER FUNCTION "model_broad_rename"."reserve"(uuid, uuid, timestamptz, timestamptz) RENAME TO "book";');
    expect(plan.sql).toContain('ALTER FUNCTION "model_broad_rename"."reservations"(uuid) RENAME TO "bookings";');

    const renamedMember = compileText(source({
      enumName: "State",
      entityName: "Reservation",
      startField: "startsAt",
      invariantName: "valid_interval",
      exclusionName: "no_overlap",
      actionName: "reserve",
      queryName: "reservations",
      version: "2",
    }).replace("ACTIVE @stableId", "ENABLED @stableId"));
    const memberError = error(() => planMigration(previous, renamedMember));
    expect(memberError.code).toBe("E2807");
    expect(memberError.message).toContain("stored-value migration is unsupported");
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
