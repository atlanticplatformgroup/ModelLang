import { ModelError, type Span } from "./diagnostics.js";
import { moneyProfile } from "./money.js";
import type { ActionDecl, Declaration, EntityDecl, Program, QueryDecl, WorkflowDecl } from "./syntax-ast.js";

export interface ResolvedProgram {
  program: Program;
  declarations: ReadonlyMap<string, Declaration>;
  entities: ReadonlyMap<string, EntityDecl>;
  actions: ReadonlyMap<string, ActionDecl>;
  queries: ReadonlyMap<string, QueryDecl>;
  workflows: ReadonlyMap<string, WorkflowDecl>;
  typeNames: ReadonlySet<string>;
}

const scalarNames = ["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"];

function validateType(type: { name: string; moneyCurrency?: string; span: Span }, typeNames: Set<string>, file: string): void {
  if (type.moneyCurrency) {
    if (!moneyProfile(type.moneyCurrency)) {
      throw new ModelError("E2901", `Unsupported money currency '${type.moneyCurrency}'.`, type.span, file);
    }
    return;
  }
  if (!typeNames.has(type.name)) throw new ModelError("E2005", `Unknown type '${type.name}'.`, type.span, file);
}

export function resolveProgram(program: Program, file: string): ResolvedProgram {
  const declarations = new Map<string, Declaration>();
  const entities = new Map<string, EntityDecl>();
  const actions = new Map<string, ActionDecl>();
  const queries = new Map<string, QueryDecl>();
  const workflows = new Map<string, WorkflowDecl>();
  for (const declaration of program.declarations) {
    const previous = declarations.get(declaration.name);
    if (previous) {
      throw new ModelError("E2001", `Duplicate declaration '${declaration.name}'.`, declaration.span, file, {
        message: "First declared here.",
        span: previous.span,
      });
    }
    declarations.set(declaration.name, declaration);
    if (declaration.kind === "entity") entities.set(declaration.name, declaration);
    if (declaration.kind === "action") actions.set(declaration.name, declaration);
    if (declaration.kind === "query") queries.set(declaration.name, declaration);
    if (declaration.kind === "workflow") workflows.set(declaration.name, declaration);
  }
  const typeNames = new Set([
    ...scalarNames,
    ...program.declarations.filter((declaration) => declaration.kind === "enum" || declaration.kind === "entity").map((declaration) => declaration.name),
  ]);
  for (const declaration of program.declarations) {
    if (declaration.kind === "entity") {
      for (const member of declaration.members) {
        if (member.kind === "field") {
          if (member.type.collection === "set" && !program.declarations.some((candidate) => candidate.kind === "enum" && candidate.name === member.type.name)) {
            throw new ModelError("E2701", `Set element type '${member.type.name}' must be a declared enum.`, member.type.span, file);
          }
          validateType(member.type, typeNames, file);
        }
      }
    }
    if (declaration.kind === "action") {
      for (const parameter of declaration.parameters) {
        if (parameter.type.collection === "set") throw new ModelError("E2704", "Set-valued action and query parameters are not supported in 0.4.", parameter.type.span, file);
        validateType(parameter.type, typeNames, file);
      }
      if (!entities.has(declaration.returnType.name)) {
        throw new ModelError("E2307", `Action return type '${declaration.returnType.name}' must be an entity.`, declaration.returnType.span, file);
      }
    }
    if (declaration.kind === "query") {
      for (const parameter of declaration.parameters) {
        if (parameter.type.collection === "set") throw new ModelError("E2704", "Set-valued action and query parameters are not supported in 0.4.", parameter.type.span, file);
        validateType(parameter.type, typeNames, file);
      }
      if (!entities.has(declaration.sourceType.name)) {
        throw new ModelError("E2601", `Query source '${declaration.sourceType.name}' must be an entity.`, declaration.sourceType.span, file);
      }
    }
  }
  return { program, declarations, entities, actions, queries, workflows, typeNames };
}
