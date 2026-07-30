import { ModelError, type Position, type Span } from "./diagnostics.js";

export type TokenKind =
  | "identifier" | "string" | "number"
  | "{" | "}" | "(" | ")" | ":" | ";" | "," | "." | "?" | "@"
  | "=" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "-" | "->"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  value?: string | number;
  span: Span;
}

function clone(position: Position): Position {
  return { ...position };
}

export function lex(source: string, file = "<source>"): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  const position = (): Position => ({ offset, line, column });
  const advance = (): string => {
    const char = source[offset++]!;
    if (char === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    return char;
  };
  const emit = (kind: TokenKind, text: string, start: Position, value?: string | number) =>
    tokens.push({ kind, text, value, span: { start: clone(start), end: position() } });

  while (offset < source.length) {
    const char = source[offset]!;
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    if (char === "/" && source[offset + 1] === "/") {
      while (offset < source.length && source[offset] !== "\n") advance();
      continue;
    }
    const start = position();
    if (/[A-Za-z_]/.test(char)) {
      let text = "";
      while (offset < source.length && /[A-Za-z0-9_]/.test(source[offset]!)) text += advance();
      emit("identifier", text, start, text);
      continue;
    }
    if (/[0-9]/.test(char)) {
      let text = "";
      while (offset < source.length && /[0-9]/.test(source[offset]!)) text += advance();
      if (source[offset] === "." && /[0-9]/.test(source[offset + 1] ?? "")) {
        text += advance();
        while (offset < source.length && /[0-9]/.test(source[offset]!)) text += advance();
      }
      emit("number", text, start, Number(text));
      continue;
    }
    if (char === '"') {
      advance();
      let value = "";
      while (offset < source.length && source[offset] !== '"') {
        if (source[offset] === "\n") throw new ModelError("E1002", "String literals may not contain newlines.", { start, end: position() }, file);
        if (source[offset] === "\\") {
          advance();
          const escaped = advance();
          const decoded: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
          if (!(escaped in decoded)) throw new ModelError("E1003", `Unsupported escape sequence \\${escaped}.`, { start, end: position() }, file);
          value += decoded[escaped];
        } else {
          value += advance();
        }
      }
      if (offset >= source.length) throw new ModelError("E1001", "Unterminated string literal.", { start, end: position() }, file);
      advance();
      emit("string", source.slice(start.offset, offset), start, value);
      continue;
    }

    const two = source.slice(offset, offset + 2);
    if (["==", "!=", "<=", ">=", "->"].includes(two)) {
      advance(); advance();
      emit(two as TokenKind, two, start);
      continue;
    }
    if ("{}():;,.?@=<>-".includes(char)) {
      advance();
      emit(char as TokenKind, char, start);
      continue;
    }
    throw new ModelError("E1000", `Unexpected character ${JSON.stringify(char)}.`, { start, end: { ...start, offset: start.offset + 1, column: start.column + 1 } }, file);
  }
  const end = position();
  tokens.push({ kind: "eof", text: "", span: { start: end, end } });
  return tokens;
}
