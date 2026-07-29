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
    expect(action.callableParameters).toEqual(["parameter:act.item"]);
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
    expect(ir.enforcement.some((entry) => entry.id === "snapshot:Record.roleAtApproval")).toBe(true);
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
  ])("rejects %s", (_name, source, code) => {
    expect(failure(source).code).toBe(code);
  });
});
