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
    expect(ir.irVersion).toBe(8);
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
    expect(ir.irVersion).toBe(8);
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
    expect(ir.irVersion).toBe(8);
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
  const query = (body: string) => minimal(body);

  it("lowers a bounded caller-scoped query and keeps the caller out of its ABI", () => {
    const ir = compileText(query(`query owned(caller actor: User) from Item as item {
      authorize true;
      where item.owner == actor;
      orderBy item.id desc;
      limit 25;
    }`), "query.model");
    const resolved = ir.queries[0]!;
    expect(ir.irVersion).toBe(8);
    expect(resolved).toMatchObject({
      id: "query:owned",
      callerParameterId: "parameter:query:owned.actor",
      callableParameters: [],
      sourceEntityId: "entity:Item",
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
    const program = parse(query(`query all(caller actor: User) from Item as item {
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

  it.each([
    ["missing caller", `query q(actor: User) from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2602"],
    ["scalar caller", `query q(caller actor: UUID) from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2603"],
    ["row-dependent authorization", `query q(caller actor: User) from Item as item { authorize item.owner == actor; where true; orderBy item.id asc; limit 10; }`, "E2610"],
    ["non-Boolean row policy", `query q(caller actor: User) from Item as item { authorize true; where item.value; orderBy item.id asc; limit 10; }`, "E2414"],
    ["optional ordering", `query q(caller actor: User) from Item as item { authorize true; where true; orderBy item.optionalFlag asc; limit 10; }`, "E2608"],
    ["wrong ordering alias", `query q(caller actor: User) from Item as item { authorize true; where true; orderBy actor.id asc; limit 10; }`, "E2606"],
    ["zero limit", `query q(caller actor: User) from Item as item { authorize true; where true; orderBy item.id asc; limit 0; }`, "E2609"],
    ["fractional limit", `query q(caller actor: User) from Item as item { authorize true; where true; orderBy item.id asc; limit 1.5; }`, "E2609"],
    ["excessive limit", `query q(caller actor: User) from Item as item { authorize true; where true; orderBy item.id asc; limit 1001; }`, "E2609"],
    ["alias collision", `query q(caller item: User) from Item as item { authorize true; where true; orderBy item.id asc; limit 10; }`, "E2605"],
  ])("rejects %s", (_name, body, code) => {
    expect(failure(query(body)).code).toBe(code);
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
    expect(ir.irVersion).toBe(8);
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
