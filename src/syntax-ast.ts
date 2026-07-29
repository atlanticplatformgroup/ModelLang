import type { Span } from "./diagnostics.js";

export type ScalarName = "String" | "Int" | "Decimal" | "Boolean" | "UUID" | "DateTime";

export interface Program {
  model: ModelDecl;
  declarations: Declaration[];
  span: Span;
}

export interface ModelDecl {
  kind: "model";
  name: string;
  version: string;
  span: Span;
}

export type Declaration = EnumDecl | EntityDecl | ActionDecl | QueryDecl;

export interface EnumDecl {
  kind: "enum";
  name: string;
  members: { name: string; span: Span }[];
  span: Span;
}

export interface TypeRef {
  name: string;
  span: Span;
}

export interface Annotation {
  name: "id" | "unique" | "min" | "minExclusive" | "max" | "snapshot";
  value?: number;
  span: Span;
}

export interface FieldDecl {
  kind: "field";
  name: string;
  type: TypeRef;
  optional: boolean;
  default?: Expression;
  annotations: Annotation[];
  span: Span;
}

export interface InvariantDecl {
  kind: "invariant";
  name: string;
  expression: Expression;
  span: Span;
}

export interface ExclusionDecl {
  kind: "exclusion";
  name: string;
  keyField: string;
  startField: string;
  endField: string;
  span: Span;
}

export interface EntityDecl {
  kind: "entity";
  name: string;
  members: (FieldDecl | InvariantDecl | ExclusionDecl)[];
  span: Span;
}

export interface ParameterDecl {
  name: string;
  type: TypeRef;
  caller: boolean;
  span: Span;
}

export interface RequireDecl {
  name: string;
  expression: Expression;
  span: Span;
}

export interface Assignment {
  field: string;
  expression: Expression;
  span: Span;
}

export interface Effect {
  kind: "create" | "update";
  target: string;
  assignments: Assignment[];
  span: Span;
}

export interface ActionDecl {
  kind: "action";
  name: string;
  parameters: ParameterDecl[];
  returnType: TypeRef;
  authorize: Expression;
  requires: RequireDecl[];
  effect: Effect;
  span: Span;
}

export interface QueryDecl {
  kind: "query";
  name: string;
  parameters: ParameterDecl[];
  sourceType: TypeRef;
  rowAlias: { name: string; span: Span };
  authorize: Expression;
  where: Expression;
  orderBy: {
    path: string[];
    direction: "asc" | "desc";
    span: Span;
  };
  limit: number;
  limitSpan: Span;
  span: Span;
}

export type Expression =
  | { kind: "literal"; value: string | number | boolean | null; literalKind: "string" | "number" | "boolean" | "null"; span: Span }
  | { kind: "path"; parts: string[]; span: Span }
  | { kind: "unary"; operator: "not"; operand: Expression; span: Span }
  | { kind: "binary"; operator: "or" | "and" | "==" | "!=" | "<" | "<=" | ">" | ">="; left: Expression; right: Expression; span: Span };
