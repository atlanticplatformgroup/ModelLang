import { ModelError, type Span } from "./diagnostics.js";
import { lex, type Token, type TokenKind } from "./lexer.js";
import type {
  ActionDecl, Annotation, Assignment, Declaration, Effect, EntityDecl, ExclusionDecl,
  Expression, FieldDecl, InvariantDecl, ParameterDecl, Program, QueryDecl, RequireDecl, TypeRef,
  PolicyDecl, WorkflowDecl,
} from "./syntax-ast.js";

const binaryPrecedence: Partial<Record<string, number>> = {
  or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, in: 3,
};

export function parse(source: string, file = "<source>"): Program {
  return new Parser(lex(source, file), file).parseProgram();
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly file: string) {}
  private current(): Token { return this.tokens[this.index]!; }
  private lookahead(offset: number): Token { return this.tokens[this.index + offset]!; }
  private previous(): Token { return this.tokens[this.index - 1]!; }
  private at(kind: TokenKind): boolean { return this.current().kind === kind; }
  private atWord(word: string): boolean { return this.current().kind === "identifier" && this.current().text === word; }
  private take(): Token { return this.tokens[this.index++]!; }
  private expect(kind: TokenKind, message = `Expected '${kind}'.`): Token {
    if (!this.at(kind)) this.fail("E1100", message);
    return this.take();
  }
  private expectWord(word: string): Token {
    if (!this.atWord(word)) this.fail("E1101", `Expected '${word}'.`);
    return this.take();
  }
  private identifier(message = "Expected an identifier."): Token {
    if (!this.at("identifier")) this.fail("E1102", message);
    return this.take();
  }
  private fail(code: string, message: string): never {
    throw new ModelError(code, message, this.current().span, this.file);
  }
  private span(start: Token | Span, end: Token | Span): Span {
    return {
      start: "span" in start ? start.span.start : start.start,
      end: "span" in end ? end.span.end : end.end,
    };
  }

  parseProgram(): Program {
    const start = this.expectWord("model");
    const name = this.identifier();
    this.expectWord("version");
    const version = this.expect("string", "Expected a model version string.");
    const modelEnd = this.expect(";");
    const model = { kind: "model" as const, name: name.text, version: String(version.value), span: this.span(start, modelEnd) };
    const declarations: Declaration[] = [];
    while (!this.at("eof")) {
      if (this.atWord("enum")) declarations.push(this.parseEnum());
      else if (this.atWord("entity")) declarations.push(this.parseEntity());
      else if (this.atWord("policy")) declarations.push(this.parsePolicy());
      else if (this.atWord("action")) declarations.push(this.parseAction());
      else if (this.atWord("query")) declarations.push(this.parseQuery());
      else if (this.atWord("workflow")) declarations.push(this.parseWorkflow());
      else this.fail("E1103", "Expected enum, entity, policy, action, query, or workflow declaration.");
    }
    return { model, declarations, span: this.span(start, this.current()) };
  }

  private parseEnum(): Declaration {
    const start = this.expectWord("enum");
    const name = this.identifier();
    const stableId = this.at("@") ? this.parseStableId("enum declaration") : undefined;
    this.expect("{");
    const members: { name: string; nameSpan: Span; stableId?: Annotation; span: Span }[] = [];
    while (!this.at("}")) {
      const member = this.identifier("Expected enum member.");
      const memberStableId = this.at("@") ? this.parseStableId("enum member") : undefined;
      members.push({
        name: member.text,
        nameSpan: member.span,
        stableId: memberStableId,
        span: memberStableId ? this.span(member, memberStableId.span) : member.span,
      });
      if (this.at(",")) {
        this.take();
        if (this.at("}")) break;
      } else if (!this.at("}")) {
        this.fail("E1104", "Expected ',' or '}' after enum member.");
      }
    }
    if (members.length === 0) this.fail("E1105", "An enum must have at least one member.");
    const end = this.expect("}");
    return { kind: "enum", name: name.text, nameSpan: name.span, stableId, members, span: this.span(start, end) };
  }

  private parseEntity(): EntityDecl {
    const start = this.expectWord("entity");
    const name = this.identifier();
    let stableId: Annotation | undefined;
    if (this.at("@")) stableId = this.parseStableId("entity declaration");
    this.expect("{");
    const members: EntityDecl["members"] = [];
    while (!this.at("}")) {
      if (this.atWord("invariant")) members.push(this.parseInvariant());
      else if (this.atWord("exclusion")) members.push(this.parseExclusion());
      else members.push(this.parseField());
    }
    const end = this.expect("}");
    return { kind: "entity", name: name.text, nameSpan: name.span, stableId, members, span: this.span(start, end) };
  }

  private parseStableId(subject: string): Annotation {
    const start = this.expect("@");
    const name = this.identifier("Expected stableId annotation.");
    if (name.text !== "stableId") this.fail("E1111", `Only @stableId is valid on a ${subject}.`);
    this.expect("(");
    const value = this.expect("string", "Expected a stable ID string.");
    const end = this.expect(")");
    return { name: "stableId", value: String(value.value), span: this.span(start, end) };
  }

  private parseTypeRef(): TypeRef {
    if (this.atWord("Set")) {
      const start = this.take();
      this.expect("<");
      const element = this.identifier("Expected an enum type inside Set<...>.");
      const end = this.expect(">");
      return { name: element.text, collection: "set", span: this.span(start, end) };
    }
    if (this.atWord("Money")) {
      const start = this.take();
      this.expect("<");
      const currency = this.identifier("Expected a currency code inside Money<...>.");
      const end = this.expect(">");
      return { name: "Money", moneyCurrency: currency.text, span: this.span(start, end) };
    }
    const token = this.identifier("Expected a type name.");
    return { name: token.text, span: token.span };
  }

  private parseField(): FieldDecl {
    const start = this.identifier("Expected a field or invariant.");
    this.expect(":");
    const type = this.parseTypeRef();
    const optional = this.at("?") ? (this.take(), true) : false;
    const defaultExpression = this.at("=") ? (this.take(), this.parseExpression()) : undefined;
    const annotations: Annotation[] = [];
    while (this.at("@")) {
      const at = this.take();
      const name = this.identifier("Expected annotation name.");
      if (!["id", "unique", "min", "minExclusive", "max", "snapshot", "generated", "immutable", "stableId"].includes(name.text)) this.fail("E1106", `Unknown annotation @${name.text}.`);
      let value: number | string | undefined;
      let end: Token = name;
      if (name.text === "min" || name.text === "minExclusive" || name.text === "max") {
        this.expect("(");
        const number = this.expect("number", `Expected numeric value for @${name.text}.`);
        value = type.moneyCurrency ? number.text : Number(number.value);
        end = this.expect(")");
      } else if (name.text === "stableId") {
        this.expect("(");
        const id = this.expect("string", "Expected a stable ID string.");
        value = String(id.value);
        end = this.expect(")");
      } else if (name.text === "generated") {
        this.expect("(");
        const strategy = this.identifier("Expected a generation strategy.");
        value = strategy.text;
        end = this.expect(")");
      }
      annotations.push({ name: name.text as Annotation["name"], value, span: this.span(at, end) });
    }
    const end = this.expect(";");
    return { kind: "field", name: start.text, type, optional, default: defaultExpression, annotations, span: this.span(start, end) };
  }

  private parseInvariant(): InvariantDecl {
    const start = this.expectWord("invariant");
    const name = this.identifier();
    const stableId = this.at("@") ? this.parseStableId("invariant declaration") : undefined;
    this.expect(":");
    const expression = this.parseExpression();
    const end = this.expect(";");
    return { kind: "invariant", name: name.text, nameSpan: name.span, stableId, expression, span: this.span(start, end) };
  }

  private parseExclusion(): ExclusionDecl {
    const start = this.expectWord("exclusion");
    const name = this.identifier();
    const stableId = this.at("@") ? this.parseStableId("exclusion declaration") : undefined;
    this.expect(":");
    this.expectWord("noOverlap");
    this.expect("(");
    const keyField = this.identifier("Expected exclusion key field.");
    this.expect(",");
    const startField = this.identifier("Expected exclusion interval start field.");
    this.expect(",");
    const endField = this.identifier("Expected exclusion interval end field.");
    this.expect(")");
    const end = this.expect(";");
    return {
      kind: "exclusion",
      name: name.text,
      nameSpan: name.span,
      stableId,
      keyField: keyField.text,
      startField: startField.text,
      endField: endField.text,
      span: this.span(start, end),
    };
  }

  private parseAction(): ActionDecl {
    const start = this.expectWord("action");
    const name = this.identifier();
    const stableId = this.at("@") ? this.parseStableId("action declaration") : undefined;
    this.expect("(");
    const parameters: ParameterDecl[] = [];
    if (!this.at(")")) {
      do {
        const parameterStart = this.current();
        const caller = this.atWord("caller") ? (this.take(), true) : false;
        const parameterName = this.identifier("Expected parameter name.");
        this.expect(":");
        const type = this.parseTypeRef();
        parameters.push({ name: parameterName.text, type, caller, span: this.span(parameterStart, type.span) });
        if (!this.at(",")) break;
        this.take();
      } while (!this.at(")"));
    }
    this.expect(")");
    this.expect("->");
    const returnType = this.parseTypeRef();
    this.expect("{");
    this.expectWord("authorize");
    const authorize = this.parseExpression();
    this.expect(";");
    const requires: RequireDecl[] = [];
    while (this.atWord("require")) {
      const requireStart = this.take();
      const requireName = this.identifier();
      this.expect(":");
      const expression = this.parseExpression();
      const end = this.expect(";");
      requires.push({ name: requireName.text, expression, span: this.span(requireStart, end) });
    }
    let idempotency: ActionDecl["idempotency"];
    if (this.atWord("idempotency")) {
      const idempotencyStart = this.take();
      this.expectWord("required");
      const idempotencyEnd = this.expect(";");
      idempotency = { mode: "required", span: this.span(idempotencyStart, idempotencyEnd) };
      if (this.atWord("idempotency")) this.fail("E1122", "An action may declare idempotency at most once.");
    }
    const effect = this.parseEffect();
    const end = this.expect("}");
    return { kind: "action", name: name.text, nameSpan: name.span, stableId, parameters, returnType, authorize, requires, idempotency, effect, span: this.span(start, end) };
  }

  private parsePolicy(): PolicyDecl {
    const start = this.expectWord("policy");
    const name = this.identifier("Expected policy name.");
    const stableId = this.at("@") ? this.parseStableId("policy declaration") : undefined;
    this.expect("(");
    const parameters: ParameterDecl[] = [];
    if (!this.at(")")) {
      do {
        const parameterStart = this.current();
        if (this.atWord("caller")) this.fail("E1120", "Policy parameters cannot declare caller binding.");
        const parameterName = this.identifier("Expected policy parameter name.");
        this.expect(":");
        const type = this.parseTypeRef();
        parameters.push({ name: parameterName.text, type, caller: false, span: this.span(parameterStart, type.span) });
        if (!this.at(",")) break;
        this.take();
      } while (!this.at(")"));
    }
    this.expect(")");
    this.expect("{");
    const branches: PolicyDecl["branches"] = [];
    while (!this.at("}")) {
      const branchStart = this.expectWord("allow");
      const branchName = this.identifier("Expected policy authority branch name.");
      const branchStableId = this.at("@") ? this.parseStableId("policy authority branch") : undefined;
      this.expect(":");
      const expression = this.parseExpression();
      const branchEnd = this.expect(";");
      branches.push({
        kind: "allow",
        name: branchName.text,
        nameSpan: branchName.span,
        stableId: branchStableId,
        expression,
        span: this.span(branchStart, branchEnd),
      });
    }
    const end = this.expect("}");
    if (branches.length === 0) this.fail("E1121", "A policy must declare at least one allow branch.");
    return { kind: "policy", name: name.text, nameSpan: name.span, stableId, parameters, branches, span: this.span(start, end) };
  }

  private parseQuery(): QueryDecl {
    const start = this.expectWord("query");
    const name = this.identifier();
    const stableId = this.at("@") ? this.parseStableId("query declaration") : undefined;
    this.expect("(");
    const parameters: ParameterDecl[] = [];
    if (!this.at(")")) {
      do {
        const parameterStart = this.current();
        const caller = this.atWord("caller") ? (this.take(), true) : false;
        const parameterName = this.identifier("Expected parameter name.");
        this.expect(":");
        const type = this.parseTypeRef();
        parameters.push({ name: parameterName.text, type, caller, span: this.span(parameterStart, type.span) });
        if (!this.at(",")) break;
        this.take();
      } while (!this.at(")"));
    }
    this.expect(")");
    this.expectWord("from");
    const sourceType = this.parseTypeRef();
    this.expectWord("as");
    const alias = this.identifier("Expected query row alias.");
    this.expect("{");
    this.expectWord("authorize");
    const authorize = this.parseExpression();
    this.expect(";");
    this.expectWord("where");
    const where = this.parseExpression();
    this.expect(";");
    const orderStart = this.expectWord("orderBy");
    const orderPath = this.parsePath();
    if (!this.atWord("asc") && !this.atWord("desc")) this.fail("E1110", "Expected query order direction 'asc' or 'desc'.");
    const direction = this.take();
    const orderEnd = this.expect(";");
    this.expectWord("limit");
    const limit = this.expect("number", "Expected an integer query limit.");
    const limitEnd = this.expect(";");
    const end = this.expect("}");
    return {
      kind: "query",
      name: name.text,
      nameSpan: name.span,
      stableId,
      parameters,
      sourceType,
      rowAlias: { name: alias.text, span: alias.span },
      authorize,
      where,
      orderBy: {
        path: orderPath.parts,
        direction: direction.text as "asc" | "desc",
        span: this.span(orderStart, orderEnd),
      },
      limit: Number(limit.value),
      limitSpan: this.span(limit, limitEnd),
      span: this.span(start, end),
    };
  }

  private parseWorkflow(): WorkflowDecl {
    const start = this.expectWord("workflow");
    const name = this.identifier("Expected workflow name.");
    const stableId = this.at("@") ? this.parseStableId("workflow declaration") : undefined;
    this.expectWord("for");
    const entity = this.identifier("Expected workflow entity.");
    this.expect(".");
    const field = this.identifier("Expected workflow state field.");
    this.expect("{");
    this.expectWord("initial");
    const initial = this.parseEnumValue("Expected qualified initial enum value.");
    this.expect(";");
    const transitions: WorkflowDecl["transitions"] = [];
    while (!this.at("}")) {
      const transitionStart = this.expectWord("transition");
      const transitionName = this.identifier("Expected transition name.");
      const transitionStableId = this.at("@") ? this.parseStableId("workflow transition") : undefined;
      this.expect(":");
      const from = this.parseEnumValue("Expected qualified source enum value.");
      this.expect("->");
      const to = this.parseEnumValue("Expected qualified destination enum value.");
      this.expectWord("by");
      const action = this.identifier("Expected transition action name.");
      const transitionEnd = this.expect(";");
      transitions.push({
        kind: "transition",
        name: transitionName.text,
        nameSpan: transitionName.span,
        stableId: transitionStableId,
        from,
        to,
        actionName: action.text,
        actionSpan: action.span,
        span: this.span(transitionStart, transitionEnd),
      });
    }
    const end = this.expect("}");
    return {
      kind: "workflow",
      name: name.text,
      nameSpan: name.span,
      stableId,
      entityName: entity.text,
      entitySpan: entity.span,
      fieldName: field.text,
      fieldSpan: field.span,
      initial,
      transitions,
      span: this.span(start, end),
    };
  }

  private parseEnumValue(message: string): { enumName: string; memberName: string; span: Span } {
    const enumeration = this.identifier(message);
    this.expect(".");
    const member = this.identifier(message);
    return { enumName: enumeration.text, memberName: member.text, span: this.span(enumeration, member) };
  }

  private parsePath(): Extract<Expression, { kind: "path" }> {
    const start = this.identifier("Expected a path.");
    const parts = [start.text];
    let end = start;
    while (this.at(".")) {
      this.take();
      end = this.identifier("Expected identifier after '.'.");
      parts.push(end.text);
    }
    return { kind: "path", parts, span: this.span(start, end) };
  }

  private parseEffect(): Effect {
    if (!this.atWord("create") && !this.atWord("update")) this.fail("E1107", "Expected create or update effect.");
    const start = this.take();
    const target = this.identifier();
    this.expect("{");
    const assignments: Assignment[] = [];
    while (!this.at("}")) {
      const field = this.identifier("Expected assignment field.");
      this.expect("=");
      const expression = this.parseExpression();
      const end = this.expect(";");
      assignments.push({ field: field.text, expression, span: this.span(field, end) });
    }
    const end = this.expect("}");
    return { kind: start.text as Effect["kind"], target: target.text, assignments, span: this.span(start, end) };
  }

  private parseExpression(minPrecedence = 0): Expression {
    let left = this.parseUnary();
    while (true) {
      const operator = this.current().text;
      const precedence = binaryPrecedence[operator];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.take();
      const right = this.parseExpression(precedence + 1);
      left = { kind: "binary", operator: operator as Extract<Expression, { kind: "binary" }>["operator"], left, right, span: this.span(left.span, right.span) };
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.atWord("not")) {
      const start = this.take();
      const operand = this.parseExpression(3);
      return { kind: "unary", operator: "not", operand, span: this.span(start, operand.span) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.current();
    if (this.at("(")) {
      this.take();
      const expression = this.parseExpression();
      this.expect(")");
      return expression;
    }
    if (this.at("string")) {
      this.take();
      return { kind: "literal", value: String(token.value), literalKind: "string", span: token.span };
    }
    if (this.at("number")) {
      this.take();
      return { kind: "literal", value: Number(token.value), literalKind: "number", span: token.span };
    }
    if (this.atWord("true") || this.atWord("false") || this.atWord("null")) {
      this.take();
      if (token.text === "null") return { kind: "literal", value: null, literalKind: "null", span: token.span };
      return { kind: "literal", value: token.text === "true", literalKind: "boolean", span: token.span };
    }
    if (this.at("identifier") && /^[A-Z]{3}$/.test(token.text)
      && (this.lookahead(1).kind === "number"
        || (this.lookahead(1).kind === "-" && this.lookahead(2).kind === "number"))) {
      const currency = this.take();
      const negative = this.at("-") ? (this.take(), true) : false;
      const amount = this.take();
      return {
        kind: "moneyLiteral",
        currency: currency.text,
        amount: `${negative ? "-" : ""}${amount.text}`,
        span: this.span(currency, amount),
      };
    }
    if (this.at("identifier")) {
      if (this.lookahead(1).kind === "(") {
        const name = this.take();
        this.expect("(");
        const args: Expression[] = [];
        if (!this.at(")")) {
          do {
            args.push(this.parseExpression());
            if (!this.at(",")) break;
            this.take();
          } while (!this.at(")"));
        }
        const end = this.expect(")");
        return { kind: "call", name: name.text, arguments: args, span: this.span(name, end) };
      }
      return this.parsePath();
    }
    this.fail("E1108", "Expected expression.");
  }
}
