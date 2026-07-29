import { ModelError } from "./diagnostics.js";
import type { ActionDecl, Declaration, EntityDecl, Program } from "./syntax-ast.js";

export interface ResolvedProgram {
  program: Program;
  declarations: ReadonlyMap<string, Declaration>;
  entities: ReadonlyMap<string, EntityDecl>;
  actions: ReadonlyMap<string, ActionDecl>;
  typeNames: ReadonlySet<string>;
}

const scalarNames = ["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"];

export function resolveProgram(program: Program, file: string): ResolvedProgram {
  const declarations = new Map<string, Declaration>();
  const entities = new Map<string, EntityDecl>();
  const actions = new Map<string, ActionDecl>();
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
  }
  const typeNames = new Set([
    ...scalarNames,
    ...program.declarations.filter((declaration) => declaration.kind === "enum" || declaration.kind === "entity").map((declaration) => declaration.name),
  ]);
  for (const declaration of program.declarations) {
    if (declaration.kind === "entity") {
      for (const member of declaration.members) {
        if (member.kind === "field" && !typeNames.has(member.type.name)) {
          throw new ModelError("E2005", `Unknown type '${member.type.name}'.`, member.type.span, file);
        }
      }
    }
    if (declaration.kind === "action") {
      for (const parameter of declaration.parameters) {
        if (!typeNames.has(parameter.type.name)) throw new ModelError("E2005", `Unknown type '${parameter.type.name}'.`, parameter.type.span, file);
      }
      if (!entities.has(declaration.returnType.name)) {
        throw new ModelError("E2307", `Action return type '${declaration.returnType.name}' must be an entity.`, declaration.returnType.span, file);
      }
    }
  }
  return { program, declarations, entities, actions, typeNames };
}
