import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { ModelError } from "../src/diagnostics.js";
import { lex } from "../src/lexer.js";
import { parse } from "../src/parser.js";

const minimal = (body: string) => `model Test version "1.0";
enum Role { EMPLOYEE, MANAGER }
entity User { id: UUID @id; role: Role; }
entity Item { id: UUID @id; owner: User; value: Decimal @min(0); optionalFlag: Boolean?; }
${body}`;

function failure(source: string): ModelError {
  try {
    compileText(source, "test.model");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    return error as ModelError;
  }
  throw new Error("Expected compilation to fail");
}

describe("lexer and parser", () => {
  it("tracks spans and ignores comments", () => {
    const tokens = lex("// heading\nmodel M version \"1\";", "test.model");
    expect(tokens[0]).toMatchObject({ text: "model", span: { start: { line: 2, column: 1 } } });
    expect(tokens.find((token) => token.kind === "string")?.value).toBe("1");
  });

  it("parses caller spans and operator precedence", () => {
    const program = parse(minimal(`action act(caller actor: User, item: Item) -> Item {
      authorize true or false and true;
      update item { value = 1; }
    }`));
    const action = program.declarations.find((declaration) => declaration.kind === "action")!;
    expect(action.parameters[0]).toMatchObject({ name: "actor", caller: true });
    expect(action.authorize).toMatchObject({
      kind: "binary",
      operator: "or",
      right: { kind: "binary", operator: "and" },
    });
  });
});

describe("semantic analysis", () => {
  it("lowers typed event consumers into canonical IR20 delivery semantics", () => {
    const ir = compileText(minimal(`event ItemChanged payload Item;
      consumer observeItem on ItemChanged(payload item: Item) -> Item {
        authorize true;
        require nonnegative: item.value >= 0;
        update item { optionalFlag = true; }
      }
      action touch(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { optionalFlag = false; }
      }`));
    expect(ir.irVersion).toBe(22);
    expect(ir.consumers).toEqual([expect.objectContaining({
      id: "consumer:observeItem",
      sourceEventId: "event:ItemChanged",
      acceptedPayloadEntityId: "entity:Item",
      delivery: {
        transport: "atLeastOnce",
        deduplication: "transactionalInbox",
        identity: "consumerAndSourceEvent",
        duplicateResult: "storedResult",
      },
      effect: expect.objectContaining({ kind: "update", target: "item" }),
    })]);
  });

  it.each([
    ["unknown event", "Missing", "Item", "E3201"],
    ["wrong event payload", "ItemChanged", "User", "E3202"],
  ])("rejects a consumer with %s", (_label, eventName, payloadType, code) => {
    expect(failure(minimal(`event ItemChanged payload Item;
      consumer observeItem on ${eventName}(payload item: ${payloadType}) -> Item {
        authorize true;
        update item { optionalFlag = true; }
      }
      action touch(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { optionalFlag = false; }
      }`)).code).toBe(code);
  });

  it("rejects emitting an imported event contract", () => {
    expect(failure(minimal(`event ImportedChanged payload Item
        from "model:Source" version "1.0.0" sourceHash "sha256:${"a".repeat(64)}";
      action change(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { optionalFlag = true; }
        emit ImportedChanged;
    }`)).code).toBe("E3107");
  });

  it("preserves an exact imported event source contract for consumption", () => {
    const hash = `sha256:${"b".repeat(64)}`;
    const ir = compileText(minimal(`event ImportedChanged payload Item
        from "model:Source" version "1.2.3" sourceHash "${hash}";
      consumer observeImported on ImportedChanged(payload item: Item) -> Item {
        authorize true;
        update item { optionalFlag = true; }
      }
      action touch(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { optionalFlag = false; }
      }`));
    expect(ir.events[0]!.source).toEqual({
      kind: "imported",
      modelId: "model:Source",
      modelVersion: "1.2.3",
      sourceHash: hash,
    });
    expect(ir.consumers[0]!.sourceEventId).toBe(ir.events[0]!.id);
  });

  it("rejects a consumer effect that bypasses a declared workflow field", () => {
    expect(failure(`model ConsumerWorkflow version "1";
      enum State { DRAFT, DONE }
      entity User { id: UUID @id; }
      entity Task { id: UUID @id; state: State = State.DRAFT; }
      event TaskCreated payload Task;
      action open(caller actor: User, id: UUID) -> Task {
        authorize true;
        create Task { id = id; state = State.DRAFT; }
        emit TaskCreated;
      }
      action finish(caller actor: User, task: Task) -> Task {
        authorize true;
        require is_draft: task.state == State.DRAFT;
        update task { state = State.DONE; }
      }
      consumer skip on TaskCreated(payload task: Task) -> Task {
        authorize true;
        update task { state = State.DONE; }
      }
      workflow Lifecycle for Task.state {
        initial State.DRAFT;
        transition finish: State.DRAFT -> State.DONE by finish;
      }`).code).toBe("E3209");
  });

  it("lowers required action idempotency as execution metadata outside the callable ABI", () => {
    const ir = compileText(minimal(`action createItem(caller actor: User, id: UUID) -> Item {
      authorize true;
      idempotency required;
      create Item { id = id; owner = actor; value = 1; optionalFlag = null; }
    }`));
    expect(ir.actions[0]).toMatchObject({
      idempotency: {
        mode: "required",
        scope: "authenticatedPrincipal",
        replay: "storedResult",
        fingerprint: "canonicalSha256",
      },
      callableParameters: ["parameter:action:createItem.id"],
    });
    expect(ir.actions[0]!.parameters.map((parameter) => parameter.name)).not.toContain("idempotencyKey");
  });

  it("rejects duplicate action idempotency declarations", () => {
    expect(failure(minimal(`action updateItem(caller actor: User, item: Item) -> Item {
      authorize true;
      idempotency required;
      idempotency required;
      update item { value = 2; }
    }`)).code).toBe("E1122");
  });

  it("lowers reusable closed policies with stable exact authority branches", () => {
    const ir = compileText(`model PolicyProof version "0.18.0";
      enum Role { EMPLOYEE, MANAGER }
      entity User { id: UUID @id; role: Role; }
      entity Item { id: UUID @id; owner: User; value: Int; }
      policy MayManage(actor: User, item: Item) {
        allow manager: actor.role == Role.MANAGER;
      }
      action updateItem(caller actor: User, item: Item) -> Item {
        authorize actor != item.owner and MayManage(actor, item);
        require still_allowed: MayManage(actor, item);
        update item { value = 2; }
      }`, "policy.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.policies).toEqual([
      expect.objectContaining({
        id: "policy:MayManage",
        branches: [expect.objectContaining({ id: "policyBranch:MayManage.manager" })],
      }),
    ]);
    expect(ir.actions[0]!.authorization.expression).toMatchObject({
      kind: "binary",
      operator: "and",
      right: { kind: "policyCall", policyId: "policy:MayManage", type: "Boolean", nullable: false },
    });
    expect(ir.enforcement.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "policy:MayManage",
      "policyBranch:MayManage.manager",
      "boundary:decision_evidence",
    ]));
  });

  it.each([
    ["unknown policy", "Missing(actor, item)", "E2416"],
    ["policy argument mismatch", "MayManage(item, actor)", "E2418"],
    ["policy under or", "true or MayManage(actor, item)", "E2422"],
    ["multiple authority policies", "MayManage(actor, item) and MayManage(actor, item)", "E2423"],
  ])("rejects %s", (_name, authorization, code) => {
    const source = `model PolicyFailure version "0.18.0";
      enum Role { MANAGER }
      entity User { id: UUID @id; role: Role; }
      entity Item { id: UUID @id; owner: User; value: Int; }
      policy MayManage(actor: User, item: Item) { allow manager: actor.role == Role.MANAGER; }
      action updateItem(caller actor: User, item: Item) -> Item {
        authorize ${authorization};
        update item { value = 2; }
      }`;
    expect(failure(source).code).toBe(code);
  });

  it("rejects recursive policy composition", () => {
    const source = `model PolicyCycle version "0.18.0";
      entity User { id: UUID @id; }
      policy First(actor: User) { allow first: Second(actor); }
      policy Second(actor: User) { allow second: First(actor); }
      action updateUser(caller actor: User) -> User {
        authorize First(actor);
        update actor { id = actor.id; }
      }`;
    expect(failure(source).code).toBe("E2420");
  });

  it("models database-generated values as immutable stored fields outside the callable ABI", () => {
    const ir = compileText(`model Generated version "0.7.0";
      entity User { id: UUID @id; }
      entity Record {
        id: UUID @id @generated(uuid);
        createdAt: DateTime @generated(now) @immutable;
        name: String;
      }
      action make(caller actor: User, name: String) -> Record {
        authorize true;
        create Record { name = name; }
      }`);
    const record = ir.entities.find((entity) => entity.name === "Record")!;
    expect(ir.irVersion).toBe(22);
    expect(record.fields.find((field) => field.name === "id")).toMatchObject({
      generation: { strategy: "uuid", authority: "database" },
      mutability: "immutable",
    });
    expect(record.fields.find((field) => field.name === "createdAt")).toMatchObject({
      generation: { strategy: "now", authority: "database" },
      mutability: "immutable",
    });
    expect(ir.actions[0]!.callableParameters).toEqual(["parameter:action:make.name"]);
    expect(ir.actions[0]!.effect.assignments.map((assignment) => assignment.fieldName)).toEqual(["name"]);
    expect(ir.enforcement.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "generated:field:Record.id",
      "immutable:field:Record.id",
      "generated:field:Record.createdAt",
      "immutable:field:Record.createdAt",
    ]));
  });

  it("produces typed nullable expressions and explicit null comparisons", () => {
    const ir = compileText(minimal(`action act(caller actor: User, item: Item) -> Item {
      authorize item.optionalFlag == null or item.optionalFlag;
      update item { value = 1; }
    }`));
    const expression = ir.actions[0]!.authorization.expression;
    expect(expression).toMatchObject({ kind: "binary", operator: "or", nullable: true });
    expect(expression.kind === "binary" && expression.left).toMatchObject({ kind: "nullComparison", nullable: false });
  });

  it("omits the caller from callable parameters and computes canonical locks", () => {
    const ir = compileText(minimal(`action act(caller actor: User, item: Item) -> Item {
      authorize actor == item.owner;
      require positive: item.value > 0;
      update item { owner = actor; }
    }`));
    const action = ir.actions[0]!;
    expect(action.callableParameters).toEqual(["parameter:action:act.item"]);
    expect(action.lockPlan).toEqual([
      expect.objectContaining({ entityId: "entity:Item", mode: "update", order: 0 }),
      expect.objectContaining({ entityId: "entity:User", mode: "share", order: 1 }),
    ]);
  });

  it("marks compatible entity equality as primary-key identity comparison", () => {
    const ir = compileText(minimal(`action act(caller actor: User, item: Item) -> Item {
      authorize actor == item.owner;
      update item { value = 2; }
    }`));
    const authorization = ir.actions[0]!.authorization.expression;
    expect(authorization).toMatchObject({
      kind: "binary",
      operator: "==",
      comparisonSemantics: "entityIdentity",
      left: { kind: "entityValue", entityId: "entity:User" },
      right: { kind: "fieldAccess", fieldId: "field:Item.owner" },
    });
    expect(ir.actions[0]!.parameters[0]).toMatchObject({ caller: true, binding: "session_user" });
  });

  it("models audit snapshots as stored scalar or enum values", () => {
    const ir = compileText(`model Snapshot version "1";
      enum Role { EMPLOYEE, MANAGER }
      entity User { id: UUID @id; role: Role; }
      entity Record { id: UUID @id; roleAtApproval: Role? @snapshot; }
      action record(caller actor: User, record: Record) -> Record {
        authorize true;
        update record { roleAtApproval = actor.role; }
      }`);
    expect(ir.entities.find((entity) => entity.name === "Record")!.fields.find((field) => field.name === "roleAtApproval"))
      .toMatchObject({ storage: "snapshot" });
    expect(ir.enforcement.some((entry) => entry.id === "snapshot:field:Record.roleAtApproval")).toBe(true);
  });

  it("is deterministic", () => {
    const source = minimal(`action act(caller actor: User, item: Item) -> Item {
      authorize actor == item.owner;
      update item { value = 2; }
    }`);
    expect(JSON.stringify(compileText(source, "same.model"))).toBe(JSON.stringify(compileText(source, "same.model")));
  });

  it.each([
    ["duplicate declarations", `${minimal("")}\nentity User { id: UUID @id; }`, "E2001"],
    ["missing caller", minimal(`action act(actor: User, item: Item) -> Item { authorize true; update item { value = 1; } }`), "E2301"],
    ["scalar caller", minimal(`action act(caller actor: UUID, item: Item) -> Item { authorize true; update item { value = 1; } }`), "E2302"],
    ["invalid annotation", `model M version "1"; entity User { id: UUID @id; name: String @min(1); } action a(caller u: User) -> User { authorize true; create User { id = u; name = "x"; } }`, "E2204"],
    ["transitive traversal", minimal(`action act(caller actor: User, item: Item) -> Item { authorize item.owner.role == Role.MANAGER; update item { value = 1; } }`), "E2405"],
    ["id update", minimal(`action act(caller actor: User, item: Item) -> Item { authorize true; update item { id = item.id; } }`), "E2314"],
    ["required null assignment", minimal(`action act(caller actor: User, id: UUID) -> Item { authorize true; create Item { id = id; owner = null; value = 1; } }`), "E2411"],
    ["unqualified enum", minimal(`action act(caller actor: User, item: Item) -> Item { authorize actor.role == MANAGER; update item { value = 1; } }`), "E2009"],
    ["entity snapshot", `model M version "1"; entity User { id: UUID @id; prior: User? @snapshot; } action a(caller u: User) -> User { authorize true; update u { prior = null; } }`, "E2207"],
    ["non-field snapshot assignment", `model M version "1"; enum Role { A } entity User { id: UUID @id; role: Role; } entity Record { id: UUID @id; roleCopy: Role? @snapshot; } action a(caller u: User, r: Record) -> Record { authorize true; update r { roleCopy = Role.A; } }`, "E2415"],
    ["generated assignment", `model M version "1"; entity User { id: UUID @id; } entity Record { id: UUID @id @generated(uuid); } action a(caller u: User, id: UUID) -> Record { authorize true; create Record { id = id; } }`, "E2316"],
    ["immutable update", `model M version "1"; entity User { id: UUID @id; } entity Record { id: UUID @id; code: String @immutable; } action a(caller u: User, r: Record) -> Record { authorize true; update r { code = "changed"; } }`, "E2317"],
    ["optional generated field", `model M version "1"; entity User { id: UUID @id; createdAt: DateTime? @generated(now); } action a(caller u: User) -> User { authorize true; update u { id = u.id; } }`, "E2208"],
    ["generated source default", `model M version "1"; entity User { id: UUID @id; createdAt: DateTime = "2020-01-01T00:00:00Z" @generated(now); } action a(caller u: User) -> User { authorize true; update u { id = u.id; } }`, "E2209"],
    ["generated snapshot", `model M version "1"; entity User { id: UUID @id; createdAt: DateTime @generated(now) @snapshot; } action a(caller u: User) -> User { authorize true; update u { id = u.id; } }`, "E2210"],
    ["unknown generation strategy", `model M version "1"; entity User { id: UUID @id @generated(sequence); } action a(caller u: User) -> User { authorize true; create User { } }`, "E2211"],
    ["generation type mismatch", `model M version "1"; entity User { id: UUID @id; name: String @generated(uuid); } action a(caller u: User, id: UUID) -> User { authorize true; create User { id = id; } }`, "E2212"],
  ])("rejects %s", (_name, source, code) => {
    expect(failure(source).code).toBe(code);
  });
});

describe("ModelLang exact money", () => {
  const moneyModel = (comparison: string, assignment = "amount") => `model MoneyProof version "0.8.0";
    entity User { id: UUID @id; }
    entity Invoice {
      id: UUID @id;
      amount: Money<USD> @minExclusive(0);
    }
    action issue(caller actor: User, id: UUID, amount: Money<USD>) -> Invoice {
      authorize true;
      require money_rule: ${comparison};
      create Invoice { id = id; amount = ${assignment}; }
    }`;

  it("preserves currency, precision, scale, and exact literals in IR v8", () => {
    const ir = compileText(moneyModel("amount <= USD 10000.25"), "money.model");
    const amount = ir.entities.find((entity) => entity.name === "Invoice")!.fields.find((field) => field.name === "amount")!;
    expect(ir.irVersion).toBe(22);
    expect(amount.type).toBe("money:USD:20:2");
    expect(amount.annotations).toContainEqual({ name: "minExclusive", value: "0" });
    expect(ir.actions[0]!.parameters.find((parameter) => parameter.name === "amount")!.type).toBe("money:USD:20:2");
    expect(ir.actions[0]!.preconditions[0]!.expression).toMatchObject({
      kind: "binary",
      operator: "<=",
      left: { kind: "parameter", type: "money:USD:20:2" },
      right: {
        kind: "moneyLiteral",
        currency: "USD",
        amount: "10000.25",
        precision: 20,
        scale: 2,
        type: "money:USD:20:2",
      },
    });
    expect(ir.enforcement.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "money:field:Invoice.amount",
      "money-parameter:parameter:action:issue.amount",
    ]));
  });

  it("supports different built-in scales without treating currencies as interchangeable", () => {
    const ir = compileText(`model CurrencyScales version "0.8.0";
      entity User { id: UUID @id; }
      entity Ledger { id: UUID @id; yen: Money<JPY>; dinar: Money<KWD>; }
      action record(caller actor: User, id: UUID, yen: Money<JPY>, dinar: Money<KWD>) -> Ledger {
        authorize true;
        require exact_scales: yen == JPY 100 and dinar == KWD 1.234 and dinar > KWD -1.000;
        create Ledger { id = id; yen = yen; dinar = dinar; }
      }`);
    expect(ir.entities[1]!.fields.map((field) => field.type)).toEqual([
      "UUID", "money:JPY:20:0", "money:KWD:20:3",
    ]);
  });

  it.each([
    ["unsupported currency", moneyModel("amount > AUD 0"), "E2901"],
    ["excess literal scale", moneyModel("amount > USD 0.001"), "E2902"],
    ["out-of-range literal", moneyModel("amount < USD 1000000000000000000"), "E2902"],
    ["excess annotation scale", moneyModel("amount > USD 0").replace("@minExclusive(0)", "@minExclusive(0.001)"), "E2902"],
    ["cross-currency ordering", moneyModel("amount > EUR 0"), "E2403"],
    ["cross-currency equality", moneyModel("amount == EUR 1"), "E2404"],
    ["bare numeric comparison", moneyModel("amount > 0"), "E2403"],
    ["cross-currency assignment", moneyModel("amount > USD 0", "EUR 1"), "E2412"],
  ])("rejects %s", (_name, source, code) => {
    expect(failure(source).code).toBe(code);
  });
});

describe("ModelLang temporal exclusions", () => {
  const reservationSource = (exclusion: string) => `model Reservations version "0.2.0";
    entity User { id: UUID @id; }
    entity Resource { id: UUID @id; }
    entity Reservation {
      id: UUID @id;
      resource: Resource;
      startsAt: DateTime;
      endsAt: DateTime;
      ${exclusion}
    }
    action reserve(caller actor: User, id: UUID, resource: Resource, startsAt: DateTime, endsAt: DateTime) -> Reservation {
      authorize true;
      require valid: startsAt < endsAt;
      create Reservation { id = id; resource = resource; startsAt = startsAt; endsAt = endsAt; }
    }`;

  it("preserves half-open no-overlap rules in the current IR", () => {
    const ir = compileText(reservationSource("exclusion no_overlap: noOverlap(resource, startsAt, endsAt);"), "reservations.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.entities.find((entity) => entity.name === "Reservation")!.temporalExclusions).toEqual([
      expect.objectContaining({
        id: "exclusion:Reservation.no_overlap",
        intervalBounds: "[)",
        keyFieldId: "field:Reservation.resource",
        startFieldId: "field:Reservation.startsAt",
        endFieldId: "field:Reservation.endsAt",
      }),
    ]);
  });

  it.each([
    ["unknown field", "exclusion no_overlap: noOverlap(room, startsAt, endsAt);", "E2501"],
    ["optional key", "optionalResource: Resource?; exclusion no_overlap: noOverlap(optionalResource, startsAt, endsAt);", "E2502"],
    ["non-DateTime interval", "bad: String; exclusion no_overlap: noOverlap(resource, bad, endsAt);", "E2503"],
    ["reused interval field", "exclusion no_overlap: noOverlap(resource, startsAt, startsAt);", "E2504"],
  ])("rejects %s", (_name, exclusion, code) => {
    expect(failure(reservationSource(exclusion)).code).toBe(code);
  });
});

describe("ModelLang authenticated queries", () => {
  const query = (body: string) => minimal(`projection ItemSummary from Item { id; value; }\n${body}`);

  it("lowers a bounded caller-scoped query and keeps the caller out of its ABI", () => {
    const ir = compileText(query(`query owned(caller actor: User) returns ItemSummary from Item as item {
      authorize true;
      where item.owner == actor;
      orderBy item.id desc;
      limit 25;
    }`), "query.model");
    const resolved = ir.queries[0]!;
    expect(ir.irVersion).toBe(22);
    expect(resolved).toMatchObject({
      id: "query:owned",
      callerParameterId: "parameter:query:owned.actor",
      callableParameters: [],
      sourceEntityId: "entity:Item",
      returnProjectionId: "projection:ItemSummary",
      rowAlias: "item",
      limit: 25,
      orderBy: {
        fieldId: "field:Item.id",
        direction: "desc",
        identityTieBreaker: true,
      },
      rowPolicy: {
        expression: {
          kind: "binary",
          comparisonSemantics: "entityIdentity",
          left: { kind: "fieldAccess", source: "queryRow" },
          right: { kind: "entityValue", entityId: "entity:User" },
        },
      },
    });
    expect(ir.projections).toEqual([expect.objectContaining({
      id: "projection:ItemSummary",
      sourceEntityId: "entity:Item",
      fields: [
        expect.objectContaining({ name: "id", sourceFieldId: "field:Item.id" }),
        expect.objectContaining({ name: "value", sourceFieldId: "field:Item.value" }),
      ],
    })]);
    expect(resolved.parameters[0]).toMatchObject({ caller: true, binding: "session_user" });
    for (const id of [
      "caller:query:owned.actor",
      "authorize:query:owned",
      "where:query:owned",
      "order:query:owned",
      "limit:query:owned",
      "read:query:owned",
      "boundary:entity:Item.direct_read",
    ]) expect(ir.enforcement.some((entry) => entry.id === id), id).toBe(true);
  });

  it("parses query clauses in their required order", () => {
    const program = parse(query(`query all(caller actor: User) returns ItemSummary from Item as item {
      authorize true;
      where item.value > 0;
      orderBy item.value asc;
      limit 10;
    }`));
    expect(program.declarations.find((declaration) => declaration.kind === "query")).toMatchObject({
      kind: "query",
      name: "all",
      sourceType: { name: "Item" },
      rowAlias: { name: "item" },
      orderBy: { path: ["item", "value"], direction: "asc" },
      limit: 10,
    });
  });

  it("lowers explicit cursor pagination with a deterministic contract revision", () => {
    const source = query(`query all(caller actor: User, minimum: Int) returns ItemSummary from Item as item {
      authorize true;
      where item.value > minimum;
      orderBy item.value asc;
      limit 10;
      paginate cursor;
    }`);
    const first = compileText(source, "cursor-query.model").queries[0]!;
    const second = compileText(source, "cursor-query.model").queries[0]!;
    expect(first.pagination).toEqual({
      kind: "cursor",
      cursorVersion: 1,
      revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(second.pagination).toEqual(first.pagination);
    expect(first.limit).toBe(10);
    expect(first.callableParameters).toEqual(["parameter:query:all.minimum"]);
    expect(compileText(source, "cursor-query.model").enforcement).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cursor:query:all", layer: "PostgreSQL keyset pagination" }),
    ]));
  });

  it("lowers optional authored filters with explicit nullable semantics", () => {
    const resolved = compileText(query(`query filtered(
      caller actor: User,
      minimum: Int?,
      owner: User?
    ) returns ItemSummary from Item as item {
      authorize true;
      where (minimum == null or item.value >= minimum) and (owner == null or item.owner == owner);
      orderBy item.value asc;
      limit 10;
    }`), "optional-query.model").queries[0]!;
    expect(resolved.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "minimum", type: "Int", optional: true, caller: false }),
      expect.objectContaining({ name: "owner", type: "entity:User", optional: true, caller: false }),
    ]));
    expect(resolved.rowPolicy.expression).toMatchObject({ kind: "binary", operator: "and", nullable: true });
    expect(JSON.stringify(resolved.rowPolicy.expression)).toContain('"kind":"nullComparison"');
    expect(resolved.callableParameters).toEqual([
      "parameter:query:filtered.minimum",
      "parameter:query:filtered.owner",
    ]);
    const ir = compileText(query(`query filtered(caller actor: User, minimum: Int?) returns ItemSummary from Item as item {
      authorize true; where minimum == null or item.value >= minimum; orderBy item.value asc; limit 10;
    }`));
    expect(ir.enforcement).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "optional-filter:parameter:query:filtered.minimum" }),
    ]));
  });

  it("rejects an optional caller parameter", () => {
    expect(failure(query(`query all(caller actor: User?) returns ItemSummary from Item as item {
      authorize true; where true; orderBy item.id asc; limit 10;
    }`)).code).toBe("E2612");
  });

  it("reserves the generated cursor input name only for paginated queries", () => {
    expect(failure(query(`query all(caller actor: User, cursor: String) returns ItemSummary from Item as item {
      authorize true; where true; orderBy item.id asc; limit 10; paginate cursor;
    }`)).code).toBe("E2611");
    expect(() => compileText(query(`query all(caller actor: User, cursor: String) returns ItemSummary from Item as item {
      authorize true; where true; orderBy item.id asc; limit 10;
    }`))).not.toThrow();
  });

  it.each([
    ["missing caller", `query q(actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2602"],
    ["scalar caller", `query q(caller actor: UUID) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2603"],
    ["row-dependent authorization", `query q(caller actor: User) returns ItemSummary from Item as item { authorize item.owner == actor; where true; orderBy item.id asc; limit 10; }`, "E2610"],
    ["non-Boolean row policy", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where item.value; orderBy item.id asc; limit 10; }`, "E2414"],
    ["optional ordering", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.optionalFlag asc; limit 10; }`, "E2608"],
    ["wrong ordering alias", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy actor.id asc; limit 10; }`, "E2606"],
    ["zero limit", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 0; }`, "E2609"],
    ["fractional limit", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 1.5; }`, "E2609"],
    ["excessive limit", `query q(caller actor: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 1001; }`, "E2609"],
    ["alias collision", `query q(caller item: User) returns ItemSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2605"],
  ])("rejects %s", (_name, body, code) => {
    expect(failure(query(body)).code).toBe(code);
  });

  it.each([
    ["unknown source field", `projection Bad from Item { missing; }`, "E2624"],
    ["duplicate source field", `projection Bad from Item { id; id; }`, "E2623"],
    ["collection source field", `projection Bad from User { roles; }`, "E2625"],
    ["non-projection query result", `projection ItemSummary from Item { id; } query q(caller actor: User) returns Item from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2620"],
    ["mismatched projection source", `projection UserSummary from User { id; } query q(caller actor: User) returns UserSummary from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2626"],
  ])("rejects projection with %s", (_name, body, code) => {
    const source = body.includes("roles")
      ? `model ProjectionFailure version "1"; enum Role { USER } entity User { id: UUID @id; roles: Set<Role>; } entity Item { id: UUID @id; } action a(caller actor: User, id: UUID) -> Item { authorize true; create Item { id = id; } } ${body}`
      : minimal(`${body} action establish(caller actor: User, item: Item) -> Item { authorize true; update item { value = item.value; } }`);
    expect(failure(source).code).toBe(code);
  });

  it("rejects an empty projection", () => {
    expect(failure(minimal("projection Empty from Item { } action establish(caller actor: User, item: Item) -> Item { authorize true; update item { value = item.value; } }")).code).toBe("E1150");
  });

  it("lowers an explicit to-one nested projection dependency", () => {
    const ir = compileText(minimal(`
      projection UserSummary from User { id; role; }
      projection ItemSummary from Item { id; owner: UserSummary; }
      query items(caller actor: User) returns ItemSummary from Item as item {
        authorize true;
        where item.owner == actor;
        orderBy item.id asc;
        limit 10;
      }
    `), "nested-projection.model");
    expect(ir.projections).toEqual([
      expect.objectContaining({ id: "projection:UserSummary", sourceEntityId: "entity:User" }),
      expect.objectContaining({
        id: "projection:ItemSummary",
        fields: [
          expect.objectContaining({ name: "id", sourceFieldId: "field:Item.id" }),
          expect.objectContaining({
            name: "owner",
            sourceFieldId: "field:Item.owner",
            nestedProjectionId: "projection:UserSummary",
          }),
        ],
      }),
    ]);
  });

  it("retains direct UUID encoding for an entity reference without a nested target", () => {
    const ir = compileText(minimal(`
      projection ItemOwner from Item { owner; }
      query items(caller actor: User) returns ItemOwner from Item as item {
        authorize true; where item.owner == actor; orderBy item.id asc; limit 10;
      }
    `));
    expect(ir.projections[0]!.fields[0]).toMatchObject({
      name: "owner",
      sourceFieldId: "field:Item.owner",
    });
    expect(ir.projections[0]!.fields[0]).not.toHaveProperty("nestedProjectionId");
  });

  it.each([
    ["unknown nested projection", "projection ItemSummary from Item { owner: Missing; }", "E2627"],
    ["nested projection on a scalar", "projection UserSummary from User { id; } projection ItemSummary from Item { value: UserSummary; }", "E2628"],
    ["mismatched nested source", "projection ItemIdentity from Item { id; } projection ItemSummary from Item { owner: ItemIdentity; }", "E2629"],
  ])("rejects %s", (_name, declarations, code) => {
    const source = minimal(`${declarations} action establish(caller actor: User, item: Item) -> Item { authorize true; update item { value = item.value; } }`);
    expect(failure(source).code).toBe(code);
  });

  it("rejects cyclic projection traversal dependencies", () => {
    const source = `model CyclicProjection version "1";
      entity User { id: UUID @id; item: Item; }
      entity Item { id: UUID @id; owner: User; }
      projection UserSummary from User { item: ItemSummary; }
      projection ItemSummary from Item { owner: UserSummary; }
      action establish(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { owner = actor; }
      }`;
    expect(failure(source).code).toBe("E2630");
  });
});

describe("ModelLang 0.4 enum sets", () => {
  const setModel = (userField: string, body: string) => `model Sets version "0.4.0";
    enum Role { EMPLOYEE, MANAGER, FINANCE }
    enum Permission { READ, WRITE }
    entity User { id: UUID @id; ${userField} }
    entity Record { id: UUID @id; rolesAtWrite: Set<Role>? @snapshot; }
    ${body}`;

  it("parses Set<Enum> fields and membership with comparison precedence", () => {
    const program = parse(setModel("roles: Set<Role>;", `action record(caller actor: User, record: Record) -> Record {
      authorize Role.EMPLOYEE in actor.roles or Role.MANAGER in actor.roles and not Role.FINANCE in actor.roles;
      update record { rolesAtWrite = actor.roles; }
    }`));
    const user = program.declarations.find((declaration) => declaration.kind === "entity" && declaration.name === "User");
    if (!user || user.kind !== "entity") throw new Error("Expected User entity");
    expect(user.members.find((member) => member.kind === "field" && member.name === "roles")).toMatchObject({
      type: { name: "Role", collection: "set" },
    });
    const action = program.declarations.find((declaration) => declaration.kind === "action")!;
    expect(action.authorize).toMatchObject({
      kind: "binary",
      operator: "or",
      left: { kind: "binary", operator: "in" },
      right: {
        kind: "binary",
        operator: "and",
        left: { kind: "binary", operator: "in" },
        right: { kind: "unary", operand: { kind: "binary", operator: "in" } },
      },
    });
  });

  it("lowers membership and full-set snapshots into the current IR", () => {
    const ir = compileText(setModel("roles: Set<Role>;", `action record(caller actor: User, record: Record) -> Record {
      authorize Role.MANAGER in actor.roles;
      update record { rolesAtWrite = actor.roles; }
    }`), "sets.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.entities.find((entity) => entity.name === "User")!.fields.find((field) => field.name === "roles"))
      .toMatchObject({ type: "set:enum:Role", optional: false, storage: "ordinary" });
    expect(ir.entities.find((entity) => entity.name === "Record")!.fields.find((field) => field.name === "rolesAtWrite"))
      .toMatchObject({ type: "set:enum:Role", optional: true, storage: "snapshot" });
    expect(ir.actions[0]!.authorization.expression).toMatchObject({
      kind: "binary",
      operator: "in",
      comparisonSemantics: "setMembership",
      nullable: false,
      left: { kind: "enumLiteral", enumId: "enum:Role", memberId: "enumMember:Role.MANAGER", memberName: "MANAGER" },
      right: { kind: "fieldAccess", fieldId: "field:User.roles", type: "set:enum:Role" },
    });
    expect(ir.enforcement.some((entry) => entry.id === "enum-set:field:User.roles")).toBe(true);
    expect(ir.enforcement.some((entry) => entry.id === "snapshot:field:Record.rolesAtWrite")).toBe(true);
  });

  it("preserves nullable membership for fail-closed Boolean boundaries", () => {
    const ir = compileText(setModel("roles: Set<Role>?;", `action record(caller actor: User, record: Record) -> Record {
      authorize Role.MANAGER in actor.roles;
      update record { rolesAtWrite = actor.roles; }
    }`));
    expect(ir.actions[0]!.authorization.expression).toMatchObject({
      kind: "binary",
      operator: "in",
      type: "Boolean",
      nullable: true,
    });
  });

  it.each([
    ["scalar element type", "roles: Set<String>;", "authorize true;", "E2701", undefined],
    ["entity element type", "roles: Set<User>;", "authorize true;", "E2701", undefined],
    ["unsupported annotation", "roles: Set<Role> @unique;", "authorize true;", "E2702", undefined],
    ["unsupported default", "roles: Set<Role> = Role.EMPLOYEE;", "authorize true;", "E2703", undefined],
    ["set-valued parameter", "roles: Set<Role>;", "authorize true;", "E2704", "roles: Set<Role>"],
    ["mismatched membership", "roles: Set<Role>;", "authorize Permission.READ in actor.roles;", "E2705", undefined],
    ["set equality", "roles: Set<Role>;", "authorize actor.roles == actor.roles;", "E2706", undefined],
    ["set ordering", "roles: Set<Role>;", "authorize actor.roles < actor.roles;", "E2706", undefined],
  ])("rejects %s", (_name, userField, authorization, code, extraParameter) => {
    const parameters = extraParameter ? `, ${extraParameter}` : "";
    const source = setModel(userField, `action record(caller actor: User, record: Record${parameters}) -> Record {
      ${authorization}
      update record { rolesAtWrite = actor.roles; }
    }`);
    expect(failure(source).code).toBe(code);
  });
});

const workflowModel = `model WorkflowProof version "0.9.0";
enum State { DRAFT, SUBMITTED, DONE }
entity User { id: UUID @id; }
entity Task {
  id: UUID @id;
  state: State = State.DRAFT;
}
action open(caller actor: User, id: UUID) -> Task {
  authorize true;
  create Task { id = id; state = State.DRAFT; }
}
action submit(caller actor: User, task: Task) -> Task {
  authorize true;
  require is_draft: task.state == State.DRAFT;
  update task { state = State.SUBMITTED; }
}
action finish(caller actor: User, task: Task) -> Task {
  authorize true;
  require is_submitted: task.state == State.SUBMITTED;
  update task { state = State.DONE; }
}
workflow TaskLifecycle for Task.state {
  initial State.DRAFT;
  transition submit: State.DRAFT -> State.SUBMITTED by submit;
  transition finish: State.SUBMITTED -> State.DONE by finish;
}`;

describe("ModelLang 0.9 workflows", () => {
  it("lowers initial state, action-backed transitions, and enforcement targets into the current IR", () => {
    const ir = compileText(workflowModel, "workflow.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.workflows).toEqual([
      expect.objectContaining({
        id: "workflow:TaskLifecycle",
        entityId: "entity:Task",
        fieldId: "field:Task.state",
        enumId: "enum:State",
        initialMemberId: "enumMember:State.DRAFT",
        transitions: [
          expect.objectContaining({
            id: "transition:TaskLifecycle.submit",
            fromMemberId: "enumMember:State.DRAFT",
            toMemberId: "enumMember:State.SUBMITTED",
            actionId: "action:submit",
          }),
          expect.objectContaining({
            id: "transition:TaskLifecycle.finish",
            fromMemberId: "enumMember:State.SUBMITTED",
            toMemberId: "enumMember:State.DONE",
            actionId: "action:finish",
          }),
        ],
      }),
    ]);
    expect(ir.enforcement.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "workflow-initial:workflow:TaskLifecycle",
      "transition:TaskLifecycle.submit",
      "transition:TaskLifecycle.finish",
    ]));
  });

  it.each([
    [
      "a state-field default that differs from initial",
      workflowModel.replace("state: State = State.DRAFT", "state: State = State.SUBMITTED"),
      "E3007",
    ],
    [
      "an action that writes a different destination",
      workflowModel.replace("update task { state = State.SUBMITTED; }", "update task { state = State.DONE; }"),
      "E3014",
    ],
    [
      "a transition action without a source-state require",
      workflowModel.replace("  require is_draft: task.state == State.DRAFT;\n", ""),
      "E3015",
    ],
    [
      "a create action that skips the initial state",
      workflowModel.replace(
        "create Task { id = id; state = State.DRAFT; }",
        "create Task { id = id; state = State.SUBMITTED; }",
      ),
      "E3016",
    ],
    [
      "an action that mutates the state outside the workflow",
      workflowModel.replace(
        "workflow TaskLifecycle",
        `action reset(caller actor: User, task: Task) -> Task {
  authorize true;
  update task { state = State.DRAFT; }
}
workflow TaskLifecycle`,
      ),
      "E3017",
    ],
    [
      "a self-transition",
      workflowModel.replace(
        "transition submit: State.DRAFT -> State.SUBMITTED by submit;",
        "transition submit: State.SUBMITTED -> State.SUBMITTED by submit;",
      ),
      "E3009",
    ],
    [
      "an unreachable enum state",
      workflowModel.replace("enum State { DRAFT, SUBMITTED, DONE }", "enum State { DRAFT, SUBMITTED, DONE, ARCHIVED }"),
      "E3018",
    ],
  ])("rejects %s", (_name, source, code) => {
    expect(failure(source).code).toBe(code);
  });
});

describe("ModelLang 0.20 transactional domain events", () => {
  const eventModel = (eventPayload = "Record", emission = "RecordChanged") => `model Events version "1";
entity User { id: UUID @id; }
entity Record { id: UUID @id @generated(uuid); }
event RecordChanged @stableId("evt_11111111111111111111111111111111") payload ${eventPayload};
action make(caller actor: User) -> Record {
  authorize true;
  create Record { }
  emit ${emission};
}`;

  it("preserves stable typed events and ordered action emissions in the current IR", () => {
    const ir = compileText(eventModel(), "events.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.events).toEqual([expect.objectContaining({
      id: "event:evt_11111111111111111111111111111111",
      name: "RecordChanged",
      payloadEntityId: "entity:Record",
    })]);
    expect(ir.actions[0]!.emittedEventIds).toEqual(["event:evt_11111111111111111111111111111111"]);
  });

  it("rejects an unknown emitted event", () => {
    expect(failure(eventModel("Record", "Missing")).code).toBe("E3102");
  });

  it("rejects an event payload that differs from the action result", () => {
    expect(failure(eventModel("User")).code).toBe("E3103");
  });
});

describe("ModelLang 0.26 event publication recovery policies", () => {
  const source = (policy = "") => `model Publication version "1";
entity User { id: UUID @id; }
entity Record { id: UUID @id @generated(uuid); }
event RecordCreated @stableId("evt_11111111111111111111111111111111") payload Record ${policy};
action make(caller actor: User) -> Record {
  authorize true;
  create Record { }
  emit RecordCreated;
}`;

  it("preserves bounded publication retry and default-disabled recovery in IR20", () => {
    const event = compileText(source("retry maxAttempts 5")).events[0]!;
    expect(event.publicationFailurePolicy).toEqual({ mode: "deadLetterAfterMaxAttempts", maxAttempts: 5, recovery: "none" });
  });

  it("preserves explicit manual publication recovery in IR20", () => {
    const event = compileText(source("retry maxAttempts 5 recovery manual")).events[0]!;
    expect(event.publicationFailurePolicy).toEqual({ mode: "deadLetterAfterMaxAttempts", maxAttempts: 5, recovery: "manual" });
  });

  it("preserves unbounded publication retry when omitted", () => {
    expect(compileText(source()).events[0]!.publicationFailurePolicy).toEqual({ mode: "unboundedRetry" });
  });

  it.each([
    ["zero", "retry maxAttempts 0", "E3402"],
    ["fractional", "retry maxAttempts 1.5", "E3402"],
    ["excessive", "retry maxAttempts 1001", "E3402"],
    ["duplicate", "retry maxAttempts 2 retry maxAttempts 3", "E1142"],
  ])("rejects a %s publication retry limit", (_label, policy, code) => {
    expect(failure(source(policy)).code).toBe(code);
  });

  it("rejects publication policy on imported events", () => {
    const imported = source("retry maxAttempts 3").replace(
      "payload Record retry maxAttempts 3",
      `payload Record from "model:Producer" version "1" sourceHash "sha256:${"a".repeat(64)}" retry maxAttempts 3`,
    );
    expect(failure(imported).code).toBe("E3502");
  });

  it("rejects manual publication recovery without bounded retry", () => {
    expect(failure(source("recovery manual")).code).toBe("E3503");
  });

  it("rejects publication recovery on imported events", () => {
    const imported = source("retry maxAttempts 3 recovery manual").replace(
      "payload Record retry maxAttempts 3 recovery manual",
      `payload Record from "model:Producer" version "1" sourceHash "sha256:${"a".repeat(64)}" recovery manual`,
    );
    expect(failure(imported).code).toBe("E3504");
  });

  it("rejects duplicate publication recovery policy", () => {
    expect(failure(source("retry maxAttempts 3 recovery manual recovery manual")).code).toBe("E1143");
  });
});

describe("ModelLang 0.22 transactional event chains", () => {
  const chainModel = (firstEmissions: string, secondConsumer = "") => `model Chains version "1";
entity User { id: UUID @id; }
entity Record { id: UUID @id; observed: Boolean = false; }
event RecordCreated @stableId("evt_11111111111111111111111111111111") payload Record;
event RecordObserved @stableId("evt_22222222222222222222222222222222") payload Record;
action touch(caller actor: User, record: Record) -> Record {
  authorize true;
  update record { observed = false; }
  emit RecordCreated;
}
consumer observe @stableId("con_11111111111111111111111111111111") on RecordCreated(payload record: Record) -> Record {
  authorize true;
  update record { observed = true; }
  ${firstEmissions}
}
${secondConsumer}`;

  it("preserves ordered consumer emissions in the current IR", () => {
    const ir = compileText(chainModel("emit RecordObserved;"), "chains.model");
    expect(ir.irVersion).toBe(22);
    expect(ir.consumers[0]!.emittedEventIds).toEqual([
      "event:evt_22222222222222222222222222222222",
    ]);
  });

  it.each([
    ["an unknown event", "emit Missing;", "E3301"],
    ["a duplicate event", "emit RecordObserved; emit RecordObserved;", "E3304"],
  ])("rejects %s", (_label, emissions, code) => {
    expect(failure(chainModel(emissions))).toMatchObject({ code });
  });

  it("rejects consumer event cycles", () => {
    const second = `consumer reset @stableId("con_22222222222222222222222222222222") on RecordObserved(payload record: Record) -> Record {
  authorize true;
  update record { observed = false; }
  emit RecordCreated;
}`;
    expect(failure(chainModel("emit RecordObserved;", second))).toMatchObject({ code: "E3305" });
  });
});

describe("ModelLang 0.24 consumer failure and recovery policies", () => {
  const source = (policy = "") => minimal(`event ItemChanged payload Item;
    consumer observeItem on ItemChanged(payload item: Item) -> Item {
      authorize true;
      ${policy}
      update item { optionalFlag = true; }
    }
    action touch(caller actor: User, item: Item) -> Item {
      authorize true;
      update item { optionalFlag = false; }
    }`);

  it("preserves bounded retry and terminal disposition policy in IR20", () => {
    const ir = compileText(source("retry maxAttempts 3;"));
    expect(ir.irVersion).toBe(22);
    expect(ir.consumers[0]!.failurePolicy).toEqual({
      mode: "deadLetterAfterMaxAttempts",
      maxAttempts: 3,
      recovery: "none",
    });
  });

  it("preserves unbounded retry when the policy is omitted", () => {
    expect(compileText(source()).consumers[0]!.failurePolicy).toEqual({ mode: "unboundedRetry" });
  });

  it("preserves opted-in manual recovery", () => {
    expect(compileText(source("retry maxAttempts 3; recovery manual;")).consumers[0]!.failurePolicy).toEqual({
      mode: "deadLetterAfterMaxAttempts",
      maxAttempts: 3,
      recovery: "manual",
    });
  });

  it.each([
    ["without bounded retry", "recovery manual;", "E3501"],
    ["duplicate", "retry maxAttempts 3; recovery manual; recovery manual;", "E1141"],
  ])("rejects manual recovery %s", (_label, policy, code) => {
    expect(failure(source(policy)).code).toBe(code);
  });

  it.each([
    ["zero", "retry maxAttempts 0;", "E3401"],
    ["fractional", "retry maxAttempts 1.5;", "E3401"],
    ["excessive", "retry maxAttempts 1001;", "E3401"],
    ["duplicate", "retry maxAttempts 2; retry maxAttempts 3;", "E1140"],
  ])("rejects a %s retry limit", (_label, policy, code) => {
    expect(failure(source(policy)).code).toBe(code);
  });
});
