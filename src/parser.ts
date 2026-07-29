import { ModelError, type Span } from "./diagnostics.js";
import { lex, type Token, type TokenKind } from "./lexer.js";
import type {
  ActionDecl, Annotation, Assignment, Declaration, Effect, EntityDecl, Expression,
  FieldDecl, InvariantDecl, ParameterDecl, Program, RequireDecl, TypeRef,
} from "./syntax-ast.js";

const binaryPrecedence: Partial<Record<string, number>> = {
  or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
};

export function parse(source: string, file = "<source>"): Program {
  return new Parser(lex(source, file), file).parseProgram();
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly file: string) {}
  private current(): Token { return this.tokens[this.index]!; }
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
      else if (this.atWord("action")) declarations.push(this.parseAction());
      else this.fail("E1103", "Expected enum, entity, or action declaration.");
    }
    return { model, declarations, span: this.span(start, this.current()) };
  }

  private parseEnum(): Declaration {
    const start = this.expectWord("enum");
    const name = this.identifier();
    this.expect("{");
    const members: { name: string; span: Span }[] = [];
    while (!this.at("}")) {
      const member = this.identifier("Expected enum member.");
      members.push({ name: member.text, span: member.span });
      if (this.at(",")) {
        this.take();
        if (this.at("}")) break;
      } else if (!this.at("}")) {
        this.fail("E1104", "Expected ',' or '}' after enum member.");
      }
    }
    if (members.length === 0) this.fail("E1105", "An enum must have at least one member.");
    const end = this.expect("}");
    return { kind: "enum", name: name.text, members, span: this.span(start, end) };
  }

  private parseEntity(): EntityDecl {
    const start = this.expectWord("entity");
    const name = this.identifier();
    this.expect("{");
    const members: (FieldDecl | InvariantDecl)[] = [];
    while (!this.at("}")) {
      members.push(this.atWord("invariant") ? this.parseInvariant() : this.parseField());
    }
    const end = this.expect("}");
    return { kind: "entity", name: name.text, members, span: this.span(start, end) };
  }

  private parseTypeRef(): TypeRef {
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
      if (!["id", "unique", "min", "minExclusive", "max", "snapshot"].includes(name.text)) this.fail("E1106", `Unknown annotation @${name.text}.`);
      let value: number | undefined;
      let end: Token = name;
      if (name.text === "min" || name.text === "minExclusive" || name.text === "max") {
        this.expect("(");
        const number = this.expect("number", `Expected numeric value for @${name.text}.`);
        value = Number(number.value);
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
    this.expect(":");
    const expression = this.parseExpression();
    const end = this.expect(";");
    return { kind: "invariant", name: name.text, expression, span: this.span(start, end) };
  }

  private parseAction(): ActionDecl {
    const start = this.expectWord("action");
    const name = this.identifier();
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
    const effect = this.parseEffect();
    const end = this.expect("}");
    return { kind: "action", name: name.text, parameters, returnType, authorize, requires, effect, span: this.span(start, end) };
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
      const operand = this.parseUnary();
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
    if (this.at("identifier")) {
      const start = this.take();
      const parts = [start.text];
      let end = start;
      while (this.at(".")) {
        this.take();
        end = this.identifier("Expected identifier after '.'.");
        parts.push(end.text);
      }
      return { kind: "path", parts, span: this.span(start, end) };
    }
    this.fail("E1108", "Expected expression.");
  }
}
