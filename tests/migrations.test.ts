import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { ModelError } from "../src/diagnostics.js";
import { planMigration } from "../src/migrations.js";
import { assignStableIds, type StableIdKind } from "../src/stable-ids.js";
import { validateEvolutionIR, validateIR } from "../src/validate-ir.js";

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

function evolutionSource(version: string, expanded: boolean): string {
  return `model SafeEvolution version "${version}";
enum Status @stableId("enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  DRAFT @stableId("emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")${expanded ? `,
  SUBMITTED @stableId("emv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")` : ""}
}
${expanded ? `enum Severity @stableId("enm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  LOW @stableId("emv_cccccccccccccccccccccccccccccccc")
}
` : ""}
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
entity Ticket @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");
  ${expanded ? `note: String? @stableId("fld_dddddddddddddddddddddddddddddddd");
  priority: Int = 0 @min(0) @stableId("fld_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  severity: Severity? @stableId("fld_ffffffffffffffffffffffffffffffff");` : ""}
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
query submitted @stableId("qry_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User) from Ticket as ticket {
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

describe("ModelLang 0.6 stable IDs", () => {
  it("assigns stable IDs to reusable policies and authority branches", () => {
    const source = `model PolicyIds version "1";
entity User { id: UUID @id; }
entity Record { id: UUID @id @generated(uuid); }
policy MayCreate(actor: User) { allow authenticated: actor == actor; }
action make(caller actor: User) -> Record { authorize MayCreate(actor); create Record { } }`;
    const assigned = assignStableIds(source, "policy-ids.model", (kind) => {
      const prefix: Record<StableIdKind, string> = {
        entity: "ent", field: "fld", enum: "enm", enumMember: "emv", event: "evt", policy: "pol", policyBranch: "pbr",
        action: "act", consumer: "con", query: "qry", invariant: "inv", exclusion: "exc", workflow: "wfl", transition: "trn",
      };
      return `${prefix[kind]}_${kind === "policy" ? "a" : kind === "policyBranch" ? "b" : "c".repeat(1)}${"0".repeat(31)}`;
    });
    expect(assigned.source).toMatch(/policy MayCreate @stableId\("pol_[0-9a-f]{32}"\)/);
    expect(assigned.source).toMatch(/allow authenticated @stableId\("pbr_[0-9a-f]{32}"\):/);
  });

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

  it("assigns stable IDs to workflows and their transitions", () => {
    const source = `model WorkflowIds version "0.9.0";
enum State { DRAFT, SUBMITTED }
entity User { id: UUID @id; }
entity Task { id: UUID @id; state: State = State.DRAFT; }
action open(caller actor: User, id: UUID) -> Task {
  authorize true;
  create Task { id = id; state = State.DRAFT; }
}
action submit(caller actor: User, task: Task) -> Task {
  authorize true;
  require is_draft: task.state == State.DRAFT;
  update task { state = State.SUBMITTED; }
}
workflow TaskLifecycle for Task.state {
  initial State.DRAFT;
  transition submit: State.DRAFT -> State.SUBMITTED by submit;
}`;
    const prefix: Record<StableIdKind, string> = {
      entity: "ent", field: "fld", enum: "enm", enumMember: "emv", event: "evt", policy: "pol", policyBranch: "pbr",
      action: "act", consumer: "con", query: "qry", invariant: "inv", exclusion: "exc",
      workflow: "wfl", transition: "trn",
    };
    let sequence = 0;
    const assigned = assignStableIds(source, "workflow-ids.model", (kind) =>
      `${prefix[kind]}_${(++sequence).toString(16).padStart(32, "0")}`);
    expect(assigned.source).toMatch(/workflow TaskLifecycle @stableId\("wfl_[0-9a-f]{32}"\)/);
    expect(assigned.source).toMatch(/transition submit @stableId\("trn_[0-9a-f]{32}"\):/);
    const ir = compileText(assigned.source, "workflow-ids.model");
    expect(ir.workflows[0]!.identity).toMatchObject({ strategy: "explicitStableId" });
    expect(ir.workflows[0]!.transitions[0]!.identity).toMatchObject({ strategy: "explicitStableId" });
    expect(assignStableIds(assigned.source, "workflow-ids.model").assigned).toBe(0);
  });

  it("assigns IDs to enums, enum members, events, invariants, exclusions, actions, and queries", () => {
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
event BookingCreated payload Booking;
action reserve(caller actor: User, id: UUID, resource: Resource, startsAt: DateTime, endsAt: DateTime) -> Booking {
  authorize true;
  create Booking { id = id; resource = resource; startsAt = startsAt; endsAt = endsAt; state = State.OPEN; }
  emit BookingCreated;
}
consumer closeAfterCreate on BookingCreated(payload booking: Booking) -> Booking {
  authorize true;
  update booking { state = State.CLOSED; }
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
      entity: "ent", field: "fld", enum: "enm", enumMember: "emv", event: "evt", policy: "pol", policyBranch: "pbr",
      action: "act", consumer: "con", query: "qry", invariant: "inv", exclusion: "exc",
      workflow: "wfl", transition: "trn",
    };
    const assigned = assignStableIds(source, "complete.model", (kind) => {
      seen.push(kind);
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${prefixes[kind]}_${next.toString(16).padStart(32, "0")}`;
    });
    expect(new Set(seen)).toEqual(new Set<StableIdKind>([
      "enum", "enumMember", "entity", "field", "event", "invariant", "exclusion", "action", "consumer", "query",
    ]));
    expect(compileText(assigned.source, "complete.model").irVersion).toBe(17);
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
    ["event", `entity User { id: UUID @id; } event UserChanged @stableId("bad") payload User;`],
    ["invariant", `entity User { id: UUID @id; invariant valid @stableId("bad"): id == id; }`],
    ["exclusion", `entity User { id: UUID @id; } entity Resource { id: UUID @id; } entity Slot { id: UUID @id; resource: Resource; starts: DateTime; ends: DateTime; exclusion no_overlap @stableId("bad"): noOverlap(resource, starts, ends); }`],
    ["action", `entity User { id: UUID @id; } action make @stableId("bad")(caller actor: User, id: UUID) -> User { authorize true; create User { id = id; } }`],
    ["query", `entity User { id: UUID @id; } query users @stableId("bad")(caller actor: User) from User as user { authorize true; where true; orderBy user.id asc; limit 10; }`],
    ["workflow", `enum State { DRAFT } entity User { id: UUID @id; state: State = State.DRAFT; } workflow Lifecycle @stableId("bad") for User.state { initial State.DRAFT; }`],
    ["transition", `enum State { DRAFT, DONE } entity User { id: UUID @id; state: State = State.DRAFT; } workflow Lifecycle for User.state { initial State.DRAFT; transition finish @stableId("bad"): State.DRAFT -> State.DONE by establish; }`],
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
    const renamed = compileText(
      source.replaceAll("State", "Lifecycle").replace('version "1"', 'version "2"'),
      "identity-renamed.model",
    );
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

describe("ModelLang 0.10 safe schema evolution", () => {
  it("normalizes IR15 recovery omission and rejects a real recovery-policy change", () => {
    const source = (version: string, recovery: boolean) => `model RecoveryEvolution version "${version}";
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
entity Record @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  observed: Boolean = false @stableId("fld_cccccccccccccccccccccccccccccccc");
}
event RecordCreated @stableId("evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") payload Record;
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> Record {
  authorize true;
  create Record { id = id; }
  emit RecordCreated;
}
consumer observe @stableId("con_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") on RecordCreated(payload record: Record) -> Record {
  authorize true;
  retry maxAttempts 3;
  ${recovery ? "recovery manual;" : ""}
  update record { observed = true; }
}`;
    const previous = compileText(source("1", false));
    const ir15 = structuredClone(previous) as unknown as { irVersion: number; consumers: { failurePolicy: { recovery?: string } }[] };
    ir15.irVersion = 15;
    delete ir15.consumers[0]!.failurePolicy.recovery;
    expect(() => validateEvolutionIR(ir15 as unknown as typeof previous)).not.toThrow();
    expect(planMigration(ir15 as unknown as typeof previous, compileText(source("2", false))).operations).toEqual([]);
    expect(error(() => planMigration(previous, compileText(source("2", true)))).code).toBe("E2807");
  });

  it("plans a new stable consumer as an additive guarded boundary", () => {
    const source = (version: string, consumer: boolean) => `model ConsumerEvolution version "${version}";
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
entity Record @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  observed: Boolean = false @stableId("fld_cccccccccccccccccccccccccccccccc");
}
event RecordCreated @stableId("evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") payload Record;
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> Record {
  authorize true;
  create Record { id = id; }
  emit RecordCreated;
}
${consumer ? `consumer observe @stableId("con_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") on RecordCreated(payload record: Record) -> Record {
  authorize true;
  update record { observed = true; }
}` : ""}`;
    const plan = planMigration(compileText(source("1", false)), compileText(source("2", true)));
    expect(plan.operations).toContainEqual({
      kind: "addConsumer",
      consumerId: "consumer:con_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "observe",
    });
    expect(plan.sql).toContain("consume_observe");
    expect(plan.sql).toContain("event_inbox");
  });

  it("accepts released IR9 through IR16 artifacts as previous baselines for an IR17 migration", () => {
    const previous = compileText(evolutionSource("1.0.0", false), "evolution-v1.model");
    const current = compileText(evolutionSource("2.0.0", true), "evolution-v2.model");
    for (const irVersion of [9, 10, 11, 12, 13, 14, 15, 16]) {
      const legacy = structuredClone(previous) as unknown as Record<string, unknown>;
      legacy.irVersion = irVersion;
      if (irVersion === 9) delete legacy.policies;
      if (irVersion < 12) {
        delete legacy.events;
        for (const action of legacy.actions as Record<string, unknown>[]) delete action.emittedEventIds;
      }
      if (irVersion < 13) delete legacy.consumers;
      else if (irVersion === 13) {
        for (const consumer of legacy.consumers as Record<string, unknown>[]) delete consumer.emittedEventIds;
      }
      if (irVersion < 15 && legacy.consumers) {
        for (const consumer of legacy.consumers as Record<string, unknown>[]) delete consumer.failurePolicy;
      }
      if (irVersion === 15 && legacy.consumers) {
        for (const consumer of legacy.consumers as { failurePolicy?: Record<string, unknown> }[]) {
          if (consumer.failurePolicy?.mode === "deadLetterAfterMaxAttempts") delete consumer.failurePolicy.recovery;
        }
      }
      if (irVersion < 17 && legacy.events) {
        for (const event of legacy.events as Record<string, unknown>[]) delete event.publicationFailurePolicy;
      }
      expect(() => validateEvolutionIR(legacy as unknown as typeof previous)).not.toThrow();
      const plan = planMigration(legacy as unknown as typeof previous, current);
      expect(plan.previousVersion).toBe("1.0.0");
      expect(plan.currentVersion).toBe("2.0.0");
      expect(plan.operations).toContainEqual(expect.objectContaining({ kind: "addEntity" }));
      expect(plan.sql).toContain("ML_MIGRATION_BASELINE:");
      expect(plan.sql).toContain("command_receipt");
    }
  });

  it("normalizes IR16 event publication policy omission and rejects a real policy change", () => {
    const source = (version: string, retry: boolean) => `model PublicationEvolution version "${version}";
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") { id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); }
entity Record @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") { id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); }
event RecordCreated @stableId("evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") payload Record ${retry ? "retry maxAttempts 5" : ""};
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> Record {
  authorize true;
  create Record { id = id; }
  emit RecordCreated;
}`;
    const previous = compileText(source("1", false));
    const ir16 = structuredClone(previous) as unknown as { irVersion: number; events: Record<string, unknown>[] };
    ir16.irVersion = 16;
    delete ir16.events[0]!.publicationFailurePolicy;
    expect(() => validateEvolutionIR(ir16 as unknown as typeof previous)).not.toThrow();
    expect(planMigration(ir16 as unknown as typeof previous, compileText(source("2", false))).operations).toEqual([]);
    expect(error(() => planMigration(previous, compileText(source("2", true)))).code).toBe("E2807");
  });

  it("refuses an existing action idempotency change on the automatic-safe path", () => {
    const previous = compileText(renameModel({ version: "1" }), "previous.model");
    const current = compileText(
      renameModel({ version: "2" }).replace("  authorize true;", "  authorize true;\n  idempotency required;"),
      "current.model",
    );
    expect(error(() => planMigration(previous, current)).code).toBe("E2807");
  });

  it("plans enum, entity, field, callable, and workflow additions as one guarded transaction", () => {
    const previous = compileText(evolutionSource("1.0.0", false), "evolution-v1.model");
    const current = compileText(evolutionSource("2.0.0", true), "evolution-v2.model");
    const plan = planMigration(previous, current);
    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "addEnum",
      "addEnumMember",
      "addEntity",
      "addField",
      "addField",
      "addField",
      "addAction",
      "addAction",
      "addQuery",
      "addTransition",
    ]);
    expect(plan.sql).toContain('CREATE TABLE "model_safe_evolution"."comment"');
    expect(plan.sql).toContain('ALTER TABLE "model_safe_evolution"."ticket" ADD COLUMN "note" text;');
    expect(plan.sql).toContain('ALTER TABLE "model_safe_evolution"."ticket" ADD COLUMN "priority" bigint NOT NULL DEFAULT 0;');
    expect(plan.sql).toContain('ALTER TABLE "model_safe_evolution"."ticket" ADD COLUMN "severity" text;');
    expect(plan.sql).toContain('DROP CONSTRAINT "ck_ticket_status_enum"');
    expect(plan.sql).toContain("CHECK ((\"status\" IN ('DRAFT', 'SUBMITTED')) IS TRUE)");
    expect(plan.sql).toContain('(OLD."status" = \'DRAFT\' AND NEW."status" = \'SUBMITTED\')');
    expect(plan.sql).toContain('CREATE OR REPLACE FUNCTION "model_safe_evolution"."submit"');
    expect(plan.sql).toContain('CREATE OR REPLACE FUNCTION "model_safe_evolution"."submitted"');
    expect(plan.sql).toContain("ML_MIGRATION_BASELINE:");
    expect(plan.sql).toContain("VALUES ('model:SafeEvolution', '2.0.0'");
  });

  it("rejects additions that need a backfill or data-dependent uniqueness proof", () => {
    const previous = compileText(evolutionSource("1.0.0", false), "evolution-v1.model");
    const required = compileText(
      evolutionSource("2.0.0", false).replace(
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");`,
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");
  ownerNote: String @stableId("fld_dddddddddddddddddddddddddddddddd");`,
      ).replace(
        "create Ticket { id = id; status = Status.DRAFT; }",
        `create Ticket { id = id; status = Status.DRAFT; ownerNote = "created"; }`,
      ),
      "required.model",
    );
    expect(error(() => planMigration(previous, required)).code).toBe("E2811");

    const unique = compileText(
      evolutionSource("2.0.0", false).replace(
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");`,
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");
  code: String = "same" @unique @stableId("fld_dddddddddddddddddddddddddddddddd");`,
      ),
      "unique.model",
    );
    expect(error(() => planMigration(previous, unique)).code).toBe("E2812");

    const invalidDefault = compileText(
      evolutionSource("2.0.0", false).replace(
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");`,
        `  status: Status = Status.DRAFT @stableId("fld_cccccccccccccccccccccccccccccccc");
  priority: Int = 0 @minExclusive(0) @stableId("fld_dddddddddddddddddddddddddddddddd");`,
      ),
      "invalid-default.model",
    );
    expect(error(() => planMigration(previous, invalidDefault)).code).toBe("E2813");
  });
});

describe("ModelLang 0.6 rename migration planning", () => {
  it("tracks stable policy and authority-branch renames while refusing semantic policy changes", () => {
    const policyModel = (version: string, policyName: string, branchName: string, expression: string) => `model PolicyEvolution version "${version}";
enum Role @stableId("enm_11111111111111111111111111111111") {
  MANAGER @stableId("emv_11111111111111111111111111111111")
}
entity User @stableId("ent_11111111111111111111111111111111") {
  id: UUID @id @stableId("fld_11111111111111111111111111111111");
  role: Role @stableId("fld_22222222222222222222222222222222");
}
entity Record @stableId("ent_22222222222222222222222222222222") {
  id: UUID @id @generated(uuid) @stableId("fld_33333333333333333333333333333333");
}
policy ${policyName} @stableId("pol_11111111111111111111111111111111")(actor: User) {
  allow ${branchName} @stableId("pbr_11111111111111111111111111111111"): ${expression};
}
action make @stableId("act_11111111111111111111111111111111")(caller actor: User) -> Record {
  authorize ${policyName}(actor);
  create Record { }
}`;
    const previous = compileText(policyModel("1", "MayApprove", "manager", "actor.role == Role.MANAGER"), "previous.model");
    const renamed = compileText(policyModel("2", "ApprovalAuthority", "managerAuthority", "actor.role == Role.MANAGER"), "current.model");
    const plan = planMigration(previous, renamed);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "renamePolicy", policyId: "policy:pol_11111111111111111111111111111111" }),
      expect.objectContaining({ kind: "renamePolicyBranch", branchId: "policyBranch:pbr_11111111111111111111111111111111" }),
    ]));
    expect(plan.sql).toContain("stable decision identity is unchanged");

    const changed = compileText(policyModel("2", "MayApprove", "manager", "false"), "changed.model");
    expect(error(() => planMigration(previous, changed)).code).toBe("E2807");
  });

  it("fails closed when a stable workflow changes", () => {
    const source = readFileSync("examples/procurement.model", "utf8");
    const previous = compileText(source, "examples/procurement.model");
    const renamed = compileText(
      source.replace("PurchaseRequestLifecycle", "RequestLifecycle"),
      "examples/procurement.model",
    );
    const workflowError = error(() => planMigration(previous, renamed));
    expect(workflowError.code).toBe("E2807");
    expect(workflowError.message).toContain("only transition additions are safe in 0.10");

    const renamedTarget = compileText(
      source.replaceAll("status", "lifecycleStatus"),
      "examples/procurement.model",
    );
    const targetError = error(() => planMigration(previous, renamedTarget));
    expect(targetError.code).toBe("E2807");
    expect(targetError.message).toContain("only transition additions are safe in 0.10");
  });

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
    expect(plan.sql).toContain("-- ModelLang safe schema migration 1.0.0 -> 2.0.0");
    expect(plan.sql).toContain('ALTER TABLE "model_rename_proof"."purchase" RENAME TO "purchase_order";');
    expect(plan.sql).toContain('ALTER TABLE "model_rename_proof"."purchase_order" RENAME COLUMN "requested_by_id" TO "requestor_id";');
    expect(plan.sql).toContain('CREATE TABLE IF NOT EXISTS "model_rename_proof_internal"."schema_migrations"');
    expect(plan.sql).toContain("ML_MIGRATION_BASELINE:");
    expect(plan.sql).toContain('CREATE OR REPLACE FUNCTION "model_rename_proof"."make"');
    expect(plan.sql).toContain('INSERT INTO "model_rename_proof_internal"."schema_migrations"');
    expect(plan.sql).toContain("'safe'");
    expect(planMigration(previous, current)).toEqual(plan);
  });

  it("renames the principal table before installing a missing 0.12 gateway boundary", () => {
    const source = (version: string, principal: string) => `model PrincipalRename version "${version}";
entity ${principal} @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
action createPrincipal @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(
  caller actor: ${principal}, id: UUID
) -> ${principal} {
  authorize true;
  create ${principal} { id = id; }
}`;
    const plan = planMigration(
      compileText(source("1.0.0", "User"), "principal-v1.model"),
      compileText(source("2.0.0", "Account"), "principal-v2.model"),
    );
    const rename = plan.sql.indexOf('ALTER TABLE "model_principal_rename"."user" RENAME TO "account";');
    const gateway = plan.sql.indexOf('CREATE TABLE IF NOT EXISTS "model_principal_rename_internal"."gateway_principal_binding"');
    expect(rename).toBeGreaterThan(-1);
    expect(gateway).toBeGreaterThan(rename);
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
    expect(memberError.message).toContain("requires stored-value migration");
  });

  it("refuses name-derived, destructive, and structural changes", () => {
    const previous = compileText(renameModel({ version: "1" }));
    const derived = compileText(`model Derived version "2";
      entity User { id: UUID @id; name: String; }
      action a(caller actor: User, id: UUID) -> User { authorize true; create User { id = id; name = "created"; } }`);
    expect(error(() => planMigration(derived, derived)).code).toBe("E2804");

    const added = compileText(renameModel({
      version: "2",
      extraField: `note: String? @stableId("fld_44444444444444444444444444444444");`,
    }));
    expect(planMigration(previous, added).operations).toContainEqual(expect.objectContaining({
      kind: "addField",
      fieldId: "field:fld_44444444444444444444444444444444",
    }));

    const required = compileText(renameModel({
      version: "2",
      extraField: `note: String @stableId("fld_44444444444444444444444444444444");`,
    }).replace(
      "requestedBy = actor;",
      `requestedBy = actor; note = "created";`,
    ));
    expect(error(() => planMigration(previous, required)).code).toBe("E2811");

    const changed = compileText(renameModel({ version: "2", fieldOptional: true }));
    expect(error(() => planMigration(previous, changed)).code).toBe("E2807");

    const removed = compileText(renameModel({ version: "3" }).replace(
      `  requestedBy: User @stableId("${fieldRequester}");\n`,
      "",
    ).replace("    requestedBy = actor;\n", ""));
    expect(error(() => planMigration(previous, removed)).code).toBe("E2805");
  });
});
