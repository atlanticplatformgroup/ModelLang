import { createHash } from "node:crypto";
import { ModelError, type Span } from "./diagnostics.js";
import type { IRAction, IREntity, IREnum, IRExpression, IRField, IRIdentity, IRLock, IRParameter, IRQuery, IRSpan, IRWorkflow, ModelIR, EnforcementEntry } from "./ir.js";
import { isMoneyType, moneyProfile, moneyType, validateMoneyAmount } from "./money.js";
import { snakeCase } from "./naming.js";
import type {
  ActionDecl, Annotation, Declaration, EntityDecl, ExclusionDecl, Expression, FieldDecl, InvariantDecl, Program, QueryDecl, TypeRef,
  WorkflowDecl,
} from "./syntax-ast.js";

const scalars = new Set(["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"]);

interface Scope {
  kind: "invariant" | "action" | "query";
  entity?: EntityDecl;
  action?: ActionDecl;
  query?: QueryDecl;
  queryEntity?: EntityDecl;
  rowAlias?: string;
  allowQueryRow?: boolean;
  parameters?: Map<string, IRParameter>;
}

interface Symbols {
  enums: Map<string, Extract<Declaration, { kind: "enum" }>>;
  entities: Map<string, EntityDecl>;
  actions: Map<string, ActionDecl>;
  queries: Map<string, QueryDecl>;
  workflows: Map<string, WorkflowDecl>;
  fields: Map<string, Map<string, FieldDecl>>;
}

function irSpan(span: Span, file: string): IRSpan {
  return {
    file,
    line: span.start.line,
    column: span.start.column,
    endLine: span.end.line,
    endColumn: span.end.column,
  };
}

function expressionText(expression: Expression): string {
  switch (expression.kind) {
    case "literal":
      return expression.literalKind === "string" ? JSON.stringify(expression.value) : String(expression.value);
    case "moneyLiteral": return `${expression.currency} ${expression.amount}`;
    case "path": return expression.parts.join(".");
    case "unary": return `not ${expressionText(expression.operand)}`;
    case "binary": return `(${expressionText(expression.left)} ${expression.operator} ${expressionText(expression.right)})`;
  }
}

function isEntityType(type: string): boolean { return type.startsWith("entity:"); }
function isEnumType(type: string): boolean { return type.startsWith("enum:"); }
function isEnumSetType(type: string): boolean { return type.startsWith("set:enum:"); }
function enumSetId(type: string): string { return type.slice("set:".length); }
function isNumeric(type: string): boolean { return type === "Int" || type === "Decimal"; }

function identity(annotation: Annotation | undefined): IRIdentity {
  return annotation
    ? { strategy: "explicitStableId", stableId: String(annotation.value) }
    : { strategy: "nameDerived" };
}

function entityId(entity: EntityDecl): string {
  return `entity:${String(entity.stableId?.value ?? entity.name)}`;
}

function fieldId(entity: EntityDecl, field: FieldDecl): string {
  const stableId = field.annotations.find((annotation) => annotation.name === "stableId")?.value;
  return `field:${String(stableId ?? `${entity.name}.${field.name}`)}`;
}

function enumId(enumeration: Extract<Declaration, { kind: "enum" }>): string {
  return `enum:${String(enumeration.stableId?.value ?? enumeration.name)}`;
}

function enumMemberId(
  enumeration: Extract<Declaration, { kind: "enum" }>,
  member: Extract<Declaration, { kind: "enum" }>["members"][number],
): string {
  return `enumMember:${String(member.stableId?.value ?? `${enumeration.name}.${member.name}`)}`;
}

function actionId(action: ActionDecl): string {
  return `action:${String(action.stableId?.value ?? action.name)}`;
}

function queryId(query: QueryDecl): string {
  return `query:${String(query.stableId?.value ?? query.name)}`;
}

function workflowId(workflow: WorkflowDecl): string {
  return `workflow:${String(workflow.stableId?.value ?? workflow.name)}`;
}

function transitionId(workflow: WorkflowDecl, transition: WorkflowDecl["transitions"][number]): string {
  return `transition:${String(transition.stableId?.value ?? `${workflow.name}.${transition.name}`)}`;
}

function invariantId(entity: EntityDecl, invariant: InvariantDecl): string {
  return `invariant:${String(invariant.stableId?.value ?? `${entity.name}.${invariant.name}`)}`;
}

function exclusionId(entity: EntityDecl, exclusion: ExclusionDecl): string {
  return `exclusion:${String(exclusion.stableId?.value ?? `${entity.name}.${exclusion.name}`)}`;
}

function entityForType(symbols: Symbols, type: string): EntityDecl {
  const entity = [...symbols.entities.values()].find((candidate) => entityId(candidate) === type);
  if (!entity) throw new Error(`E2900 Unknown resolved entity type '${type}'.`);
  return entity;
}

export function analyze(program: Program, source: string, file: string): ModelIR {
  const symbols = collectSymbols(program, file);
  const stableIds = new Map<string, Span>();
  validateDeclarationIdentities(symbols, stableIds, file);
  validateEntities(symbols, stableIds, file);
  const principalNames = new Set<string>();
  for (const action of symbols.actions.values()) {
    const callers = action.parameters.filter((parameter) => parameter.caller);
    if (callers.length !== 1) throw new ModelError("E2301", `Action '${action.name}' must declare exactly one caller parameter.`, action.span, file);
    const caller = callers[0]!;
    if (!symbols.entities.has(caller.type.name)) throw new ModelError("E2302", `Caller '${caller.name}' must have an entity type.`, caller.type.span, file);
    principalNames.add(caller.type.name);
  }
  for (const query of symbols.queries.values()) {
    const callers = query.parameters.filter((parameter) => parameter.caller);
    if (callers.length !== 1) throw new ModelError("E2602", `Query '${query.name}' must declare exactly one caller parameter.`, query.span, file);
    const caller = callers[0]!;
    if (!symbols.entities.has(caller.type.name)) throw new ModelError("E2603", `Query caller '${caller.name}' must have an entity type.`, caller.type.span, file);
    principalNames.add(caller.type.name);
  }
  if (symbols.actions.size === 0 && symbols.queries.size === 0) throw new ModelError("E2303", "A model must declare at least one action or query to establish its principal type.", program.model.span, file);
  if (principalNames.size !== 1) throw new ModelError("E2304", "All actions and queries must use the same principal entity type.", program.model.span, file);
  const principalName = [...principalNames][0]!;
  const schema = `model_${snakeCase(program.model.name)}`;
  const internalSchema = `${schema}_internal`;

  const enums = [...symbols.enums.values()].map((declaration) => ({
    id: enumId(declaration),
    name: declaration.name,
    identity: identity(declaration.stableId),
    members: declaration.members.map((member) => ({
      id: enumMemberId(declaration, member),
      name: member.name,
      identity: identity(member.stableId),
      span: irSpan(member.span, file),
      naming: { sqlValue: member.name, typescriptValue: member.name },
    })),
    span: irSpan(declaration.span, file),
    naming: { sqlCheckPrefix: `ck_enum_${snakeCase(declaration.name)}`, typescriptName: declaration.name },
  }));
  const entities: IREntity[] = [...symbols.entities.values()].map((entity) => lowerEntity(entity, symbols, file));
  const actions: IRAction[] = [...symbols.actions.values()].map((action) => lowerAction(action, symbols, principalName, file));
  const queries: IRQuery[] = [...symbols.queries.values()].map((query) => lowerQuery(query, symbols, principalName, file));
  const workflows = lowerWorkflows(symbols, entities, enums, actions, file);
  const enforcement = buildEnforcement(enums, entities, actions, queries, workflows, schema, internalSchema);
  return {
    irVersion: 9,
    model: {
      id: `model:${program.model.name}`,
      name: program.model.name,
      version: program.model.version,
      sourceHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
      sourceFile: file,
      naming: { sqlSchema: schema, internalSchema },
    },
    principal: { entityId: entityId(symbols.entities.get(principalName)!), bindingMechanism: "session_user" },
    enums,
    entities,
    actions,
    queries,
    workflows,
    enforcement,
  };
}

function collectSymbols(program: Program, file: string): Symbols {
  const enums = new Map<string, Extract<Declaration, { kind: "enum" }>>();
  const entities = new Map<string, EntityDecl>();
  const actions = new Map<string, ActionDecl>();
  const queries = new Map<string, QueryDecl>();
  const workflows = new Map<string, WorkflowDecl>();
  const top = new Map<string, Declaration>();
  for (const declaration of program.declarations) {
    const previous = top.get(declaration.name);
    if (previous) throw new ModelError("E2001", `Duplicate declaration '${declaration.name}'.`, declaration.span, file, { message: "First declared here.", span: previous.span });
    top.set(declaration.name, declaration);
    if (declaration.kind === "enum") enums.set(declaration.name, declaration);
    if (declaration.kind === "entity") entities.set(declaration.name, declaration);
    if (declaration.kind === "action") actions.set(declaration.name, declaration);
    if (declaration.kind === "query") queries.set(declaration.name, declaration);
    if (declaration.kind === "workflow") workflows.set(declaration.name, declaration);
  }
  for (const enumeration of enums.values()) {
    const seen = new Set<string>();
    for (const member of enumeration.members) {
      if (seen.has(member.name)) throw new ModelError("E2002", `Duplicate enum member '${member.name}'.`, member.span, file);
      seen.add(member.name);
    }
  }
  const fields = new Map<string, Map<string, FieldDecl>>();
  for (const entity of entities.values()) {
    const entityFields = new Map<string, FieldDecl>();
    const ruleNames = new Set<string>();
    for (const member of entity.members) {
      if (member.kind === "field") {
        const previous = entityFields.get(member.name);
        if (previous) throw new ModelError("E2003", `Duplicate field '${entity.name}.${member.name}'.`, member.span, file, { message: "First declared here.", span: previous.span });
        entityFields.set(member.name, member);
      } else {
        if (ruleNames.has(member.name)) throw new ModelError("E2004", `Duplicate entity rule '${entity.name}.${member.name}'.`, member.span, file);
        ruleNames.add(member.name);
      }
    }
    fields.set(entity.name, entityFields);
  }
  return { enums, entities, actions, queries, workflows, fields };
}

type StableDeclarationKind = "ent" | "fld" | "enm" | "emv" | "act" | "qry" | "inv" | "exc" | "wfl" | "trn";

function validateDeclarationIdentities(symbols: Symbols, stableIds: Map<string, Span>, file: string): void {
  for (const enumeration of symbols.enums.values()) {
    if (enumeration.stableId) validateStableId(enumeration.stableId, "enm", stableIds, file);
    for (const member of enumeration.members) {
      if (member.stableId) validateStableId(member.stableId, "emv", stableIds, file);
    }
  }
  for (const action of symbols.actions.values()) {
    if (action.stableId) validateStableId(action.stableId, "act", stableIds, file);
  }
  for (const query of symbols.queries.values()) {
    if (query.stableId) validateStableId(query.stableId, "qry", stableIds, file);
  }
  for (const workflow of symbols.workflows.values()) {
    if (workflow.stableId) validateStableId(workflow.stableId, "wfl", stableIds, file);
    for (const transition of workflow.transitions) {
      if (transition.stableId) validateStableId(transition.stableId, "trn", stableIds, file);
    }
  }
}

function validateEntities(symbols: Symbols, stableIds: Map<string, Span>, file: string): void {
  for (const entity of symbols.entities.values()) {
    if (entity.stableId) validateStableId(entity.stableId, "ent", stableIds, file);
    const fields = [...symbols.fields.get(entity.name)!.values()];
    const ids = fields.filter((field) => field.annotations.some((annotation) => annotation.name === "id"));
    if (ids.length !== 1) throw new ModelError("E2201", `Entity '${entity.name}' must have exactly one @id field.`, entity.span, file);
    const id = ids[0]!;
    if (id.type.name !== "UUID" || id.type.collection || id.optional) throw new ModelError("E2202", `The @id field '${entity.name}.${id.name}' must be required UUID.`, id.span, file);
    for (const field of fields) {
      if (field.type.collection === "set" && !symbols.enums.has(field.type.name)) {
        throw new ModelError("E2701", `Set element type '${field.type.name}' must be a declared enum.`, field.type.span, file);
      }
      if (!field.type.moneyCurrency && !field.type.collection && !scalars.has(field.type.name) && !symbols.enums.has(field.type.name) && !symbols.entities.has(field.type.name)) {
        throw new ModelError("E2005", `Unknown type '${field.type.name}'.`, field.type.span, file);
      }
      const annotationNames = new Set<string>();
      for (const annotation of field.annotations) {
        if (annotationNames.has(annotation.name)) throw new ModelError("E2203", `Duplicate @${annotation.name} annotation.`, annotation.span, file);
        annotationNames.add(annotation.name);
        if (annotation.name === "stableId") {
          validateStableId(annotation, "fld", stableIds, file);
          continue;
        }
        if (field.type.collection === "set" && annotation.name !== "snapshot" && annotation.name !== "immutable") {
          throw new ModelError("E2702", `@${annotation.name} is not supported on enum-set fields in 0.4.`, annotation.span, file);
        }
        if ((annotation.name === "min" || annotation.name === "minExclusive" || annotation.name === "max")
          && !["Int", "Decimal"].includes(field.type.name) && !field.type.moneyCurrency) {
          throw new ModelError("E2204", `@${annotation.name} is valid only on Int, Decimal, and Money fields.`, annotation.span, file);
        }
        if ((annotation.name === "min" || annotation.name === "minExclusive" || annotation.name === "max") && field.type.moneyCurrency) {
          const profile = moneyProfile(field.type.moneyCurrency)!;
          const invalid = validateMoneyAmount(String(annotation.value), profile);
          if (invalid) {
            throw new ModelError("E2902", `Invalid ${profile.currency} value in @${annotation.name}: ${invalid}.`, annotation.span, file);
          }
        }
        if (annotation.name === "unique" && field.optional) throw new ModelError("E2205", "@unique is not supported on optional fields.", annotation.span, file);
        if (annotation.name === "snapshot" && symbols.entities.has(field.type.name)) {
          throw new ModelError("E2207", "@snapshot is for stored scalar or enum audit values, not entity references.", annotation.span, file);
        }
      }
      const generated = field.annotations.find((annotation) => annotation.name === "generated");
      if (generated) {
        if (field.optional) throw new ModelError("E2208", `@generated field '${entity.name}.${field.name}' must be required.`, generated.span, file);
        if (field.default) throw new ModelError("E2209", `@generated field '${entity.name}.${field.name}' may not also declare a source default.`, field.default.span, file);
        if (field.annotations.some((annotation) => annotation.name === "snapshot")) {
          throw new ModelError("E2210", `@generated field '${entity.name}.${field.name}' may not be a @snapshot.`, generated.span, file);
        }
        const strategy = String(generated.value);
        if (strategy !== "uuid" && strategy !== "now") {
          throw new ModelError("E2211", `Unknown generation strategy '${strategy}'. Supported strategies are uuid and now.`, generated.span, file);
        }
        if ((strategy === "uuid" && (field.type.name !== "UUID" || field.type.collection))
          || (strategy === "now" && (field.type.name !== "DateTime" || field.type.collection))) {
          throw new ModelError("E2212", `@generated(${strategy}) is not valid on ${field.type.collection ? "Set" : field.type.name}; uuid requires UUID and now requires DateTime.`, generated.span, file);
        }
      }
      if (field.default) {
        if (field.type.collection === "set") throw new ModelError("E2703", "Enum-set defaults are not supported in 0.4.", field.default.span, file);
        if (!isCompileTimeConstant(field.default, symbols)) throw new ModelError("E2206", "Field defaults must be compile-time constants.", field.default.span, file);
        const typed = typeExpression(field.default, { kind: "invariant", entity }, symbols, file);
        ensureAssignable(field, typed, symbols, field.default.span, file);
      }
    }
    for (const exclusion of entity.members.filter((member) => member.kind === "exclusion")) {
      if (exclusion.stableId) validateStableId(exclusion.stableId, "exc", stableIds, file);
      const key = symbols.fields.get(entity.name)!.get(exclusion.keyField);
      const start = symbols.fields.get(entity.name)!.get(exclusion.startField);
      const end = symbols.fields.get(entity.name)!.get(exclusion.endField);
      if (!key || !start || !end) {
        const missing = !key ? exclusion.keyField : !start ? exclusion.startField : exclusion.endField;
        throw new ModelError("E2501", `Temporal exclusion '${exclusion.name}' references unknown field '${entity.name}.${missing}'.`, exclusion.span, file);
      }
      if (key.optional || !symbols.entities.has(key.type.name)) {
        throw new ModelError("E2502", `Temporal exclusion key '${entity.name}.${key.name}' must be a required entity reference.`, key.span, file);
      }
      if (start.optional || end.optional || start.type.name !== "DateTime" || end.type.name !== "DateTime") {
        throw new ModelError("E2503", `Temporal exclusion interval fields must be required DateTime fields.`, exclusion.span, file);
      }
      if (new Set([exclusion.keyField, exclusion.startField, exclusion.endField]).size !== 3) {
        throw new ModelError("E2504", "Temporal exclusion key, start, and end fields must be distinct.", exclusion.span, file);
      }
    }
    for (const invariant of entity.members.filter((member) => member.kind === "invariant")) {
      if (invariant.stableId) validateStableId(invariant.stableId, "inv", stableIds, file);
    }
  }
}

function validateStableId(annotation: { value?: number | string; span: Span }, kind: StableDeclarationKind, seen: Map<string, Span>, file: string): void {
  const value = typeof annotation.value === "string" ? annotation.value : "";
  const pattern = new RegExp(`^${kind}_[0-9a-f]{32}$`);
  if (!pattern.test(value)) {
    const subject: Record<StableDeclarationKind, string> = {
      ent: "entity",
      fld: "field",
      enm: "enum",
      emv: "enum member",
      act: "action",
      qry: "query",
      inv: "invariant",
      exc: "exclusion",
      wfl: "workflow",
      trn: "workflow transition",
    };
    throw new ModelError("E2801", `Stable ${subject[kind]} ID must match ${kind}_[0-9a-f]{32}.`, annotation.span, file);
  }
  const previous = seen.get(value);
  if (previous) throw new ModelError("E2802", `Duplicate stable ID '${value}'.`, annotation.span, file, { message: "First declared here.", span: previous });
  seen.set(value, annotation.span);
}

function isCompileTimeConstant(expression: Expression, symbols: Symbols): boolean {
  return expression.kind === "literal" || expression.kind === "moneyLiteral"
    || (expression.kind === "path" && expression.parts.length === 2 && Boolean(symbols.enums.get(expression.parts[0]!)?.members.some((member) => member.name === expression.parts[1])));
}

function resolvedType(type: TypeRef, symbols: Symbols): string {
  if (type.moneyCurrency) return moneyType(moneyProfile(type.moneyCurrency)!);
  if (type.collection === "set") return `set:${enumId(symbols.enums.get(type.name)!)}`;
  if (symbols.entities.has(type.name)) return entityId(symbols.entities.get(type.name)!);
  if (symbols.enums.has(type.name)) return enumId(symbols.enums.get(type.name)!);
  return type.name;
}

function fieldType(field: FieldDecl, symbols: Symbols): string {
  return resolvedType(field.type, symbols);
}

function lowerEntity(entity: EntityDecl, symbols: Symbols, file: string): IREntity {
  const fields: IRField[] = entity.members.filter((member): member is FieldDecl => member.kind === "field").map((field) => ({
    id: fieldId(entity, field),
    name: field.name,
    identity: identity(field.annotations.find((annotation) => annotation.name === "stableId")),
    type: fieldType(field, symbols),
    optional: field.optional,
    default: field.default ? typeExpression(field.default, { kind: "invariant", entity }, symbols, file) : undefined,
    annotations: field.annotations.filter((annotation) => annotation.name !== "stableId").map(({ name, value }) => ({
      name,
      ...(typeof value === "number" || typeof value === "string" ? { value } : {}),
    })),
    storage: field.annotations.some((annotation) => annotation.name === "snapshot") ? "snapshot" : "ordinary",
    ...(field.annotations.some((annotation) => annotation.name === "generated")
      ? {
          generation: {
            strategy: String(field.annotations.find((annotation) => annotation.name === "generated")!.value) as "uuid" | "now",
            authority: "database" as const,
          },
        }
      : {}),
    mutability: field.annotations.some((annotation) => annotation.name === "immutable" || annotation.name === "generated")
      ? "immutable"
      : "mutable",
    span: irSpan(field.span, file),
    naming: { sqlColumn: isEntityType(fieldType(field, symbols)) ? `${snakeCase(field.name)}_id` : snakeCase(field.name) },
  }));
  const id = fields.find((field) => field.annotations.some((annotation) => annotation.name === "id"))!;
  const invariants = entity.members.filter((member) => member.kind === "invariant").map((invariant) => {
    const expression = typeExpression(invariant.expression, { kind: "invariant", entity }, symbols, file);
    requireBoolean(expression, invariant.expression.span, file, "Invariant");
    return {
      id: invariantId(entity, invariant),
      name: invariant.name,
      identity: identity(invariant.stableId),
      expression,
      sourceExpression: expressionText(invariant.expression),
      span: irSpan(invariant.span, file),
      naming: { sqlConstraint: `ck_${snakeCase(entity.name)}_${snakeCase(invariant.name)}` },
    };
  });
  const temporalExclusions = entity.members.filter((member) => member.kind === "exclusion").map((exclusion) => ({
    id: exclusionId(entity, exclusion),
    name: exclusion.name,
    identity: identity(exclusion.stableId),
    keyFieldId: fieldId(entity, symbols.fields.get(entity.name)!.get(exclusion.keyField)!),
    startFieldId: fieldId(entity, symbols.fields.get(entity.name)!.get(exclusion.startField)!),
    endFieldId: fieldId(entity, symbols.fields.get(entity.name)!.get(exclusion.endField)!),
    intervalBounds: "[)" as const,
    sourceExpression: `noOverlap(${exclusion.keyField}, ${exclusion.startField}, ${exclusion.endField})`,
    span: irSpan(exclusion.span, file),
    naming: {
      sqlExclusionConstraint: `ex_${snakeCase(entity.name)}_${snakeCase(exclusion.name)}`,
      sqlValidIntervalConstraint: `ck_${snakeCase(entity.name)}_${snakeCase(exclusion.name)}_valid_interval`,
    },
  }));
  return {
    id: entityId(entity),
    name: entity.name,
    identity: identity(entity.stableId),
    fields,
    invariants,
    temporalExclusions,
    idFieldId: id.id,
    span: irSpan(entity.span, file),
    naming: { sqlTable: snakeCase(entity.name), typescriptName: entity.name },
  };
}

function lowerAction(action: ActionDecl, symbols: Symbols, principalName: string, file: string): IRAction {
  const semanticId = actionId(action);
  const seen = new Map<string, Span>();
  const parameters: IRParameter[] = action.parameters.map((parameter) => {
    const previous = seen.get(parameter.name);
    if (previous) throw new ModelError("E2305", `Duplicate parameter '${parameter.name}'.`, parameter.span, file, { message: "First declared here.", span: previous });
    seen.set(parameter.name, parameter.span);
    if (parameter.type.collection === "set") throw new ModelError("E2704", "Set-valued action and query parameters are not supported in 0.4.", parameter.type.span, file);
    if (!parameter.type.moneyCurrency && !scalars.has(parameter.type.name) && !symbols.enums.has(parameter.type.name) && !symbols.entities.has(parameter.type.name)) {
      throw new ModelError("E2005", `Unknown type '${parameter.type.name}'.`, parameter.type.span, file);
    }
    const type = resolvedType(parameter.type, symbols);
    return {
      id: `parameter:${semanticId}.${parameter.name}`,
      name: parameter.name,
      type,
      caller: parameter.caller,
      ...(parameter.caller ? { binding: "session_user" as const } : {}),
      span: irSpan(parameter.span, file),
      naming: { sqlParameter: `p_${snakeCase(parameter.name)}`, typescriptProperty: parameter.name },
    };
  });
  const parameterMap = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const caller = parameters.find((parameter) => parameter.caller)!;
  if (caller.type !== entityId(symbols.entities.get(principalName)!)) throw new ModelError("E2304", "Caller principal type is inconsistent with the model.", action.span, file);
  const scope: Scope = { kind: "action", action, parameters: parameterMap };
  const authorization = typeExpression(action.authorize, scope, symbols, file);
  requireBoolean(authorization, action.authorize.span, file, "Authorization");
  const preconditionNames = new Set<string>();
  const preconditions = action.requires.map((requirement) => {
    if (preconditionNames.has(requirement.name)) throw new ModelError("E2306", `Duplicate precondition '${requirement.name}'.`, requirement.span, file);
    preconditionNames.add(requirement.name);
    const expression = typeExpression(requirement.expression, scope, symbols, file);
    requireBoolean(expression, requirement.expression.span, file, "Precondition");
    return { id: `require:${semanticId}.${requirement.name}`, name: requirement.name, expression, sourceExpression: expressionText(requirement.expression), span: irSpan(requirement.span, file) };
  });
  const returnEntity = symbols.entities.get(action.returnType.name);
  if (!returnEntity) throw new ModelError("E2307", `Action return type '${action.returnType.name}' must be an entity.`, action.returnType.span, file);
  let effectEntity: EntityDecl;
  let targetParameter: IRParameter | undefined;
  if (action.effect.kind === "create") {
    const entity = symbols.entities.get(action.effect.target);
    if (!entity) throw new ModelError("E2308", `Unknown create target entity '${action.effect.target}'.`, action.effect.span, file);
    effectEntity = entity;
  } else {
    targetParameter = parameterMap.get(action.effect.target);
    if (!targetParameter || !isEntityType(targetParameter.type)) throw new ModelError("E2309", `Update target '${action.effect.target}' must be an entity parameter.`, action.effect.span, file);
    if (targetParameter.caller) throw new ModelError("E2310", "The caller parameter may not be an update target.", action.effect.span, file);
    effectEntity = entityForType(symbols, targetParameter.type);
  }
  if (returnEntity.name !== effectEntity.name) throw new ModelError("E2311", "Action return type must match the created or updated entity.", action.returnType.span, file);
  const effectFields = symbols.fields.get(effectEntity.name)!;
  const assigned = new Set<string>();
  const assignments = action.effect.assignments.map((assignment) => {
    if (assigned.has(assignment.field)) throw new ModelError("E2312", `Field '${assignment.field}' is assigned more than once.`, assignment.span, file);
    assigned.add(assignment.field);
    const field = effectFields.get(assignment.field);
    if (!field) throw new ModelError("E2313", `Unknown field '${effectEntity.name}.${assignment.field}'.`, assignment.span, file);
    if (field.annotations.some((annotation) => annotation.name === "generated")) {
      throw new ModelError("E2316", `Action effects may not assign database-generated field '${effectEntity.name}.${field.name}'.`, assignment.span, file);
    }
    if (action.effect.kind === "update" && field.annotations.some((annotation) => annotation.name === "immutable")) {
      throw new ModelError("E2317", `An update may not change immutable field '${effectEntity.name}.${field.name}'.`, assignment.span, file);
    }
    if (action.effect.kind === "update" && field.annotations.some((annotation) => annotation.name === "id")) {
      throw new ModelError("E2314", "An update may not change an @id field.", assignment.span, file);
    }
    const expression = typeExpression(assignment.expression, scope, symbols, file);
    ensureAssignable(field, expression, symbols, assignment.expression.span, file);
    if (field.annotations.some((annotation) => annotation.name === "snapshot")
      && expression.kind !== "nullLiteral"
      && expression.kind !== "fieldAccess") {
      throw new ModelError("E2415", `@snapshot field '${field.name}' must be assigned null or a direct field value.`, assignment.expression.span, file);
    }
    return { fieldId: fieldId(effectEntity, field), fieldName: field.name, expression };
  });
  if (action.effect.kind === "create") {
    for (const field of effectFields.values()) {
      if (!field.optional && !field.default
        && !field.annotations.some((annotation) => annotation.name === "generated")
        && !assigned.has(field.name)) {
        throw new ModelError("E2315", `Create effect must assign required field '${effectEntity.name}.${field.name}'.`, action.effect.span, file);
      }
    }
  }

  const usedParameters = new Set<string>();
  collectEntityParameters(authorization, usedParameters);
  for (const precondition of preconditions) collectEntityParameters(precondition.expression, usedParameters);
  for (const assignment of assignments) collectEntityParameters(assignment.expression, usedParameters);
  const locks: Omit<IRLock, "order">[] = [];
  if (targetParameter) {
    locks.push({ id: `lock:${semanticId}.${targetParameter.name}`, source: targetParameter.id, parameterId: targetParameter.id, entityId: targetParameter.type, mode: "update" });
    usedParameters.delete(targetParameter.id);
  }
  for (const parameterId of usedParameters) {
    const parameter = parameters.find((candidate) => candidate.id === parameterId)!;
    locks.push({
      id: `lock:${semanticId}.${parameter.name}`,
      source: parameter.caller ? "caller" : parameter.id,
      parameterId: parameter.id,
      entityId: parameter.type,
      mode: "share",
    });
  }
  locks.sort((left, right) => left.entityId.localeCompare(right.entityId) || left.source.localeCompare(right.source));
  const lockPlan = locks.map((lock, order) => ({ ...lock, order }));
  return {
    id: semanticId,
    name: action.name,
    identity: identity(action.stableId),
    parameters,
    callerParameterId: caller.id,
    callableParameters: parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id),
    returnEntityId: entityId(returnEntity),
    authorization: { id: `authorize:${semanticId}`, name: "authorize", expression: authorization, sourceExpression: expressionText(action.authorize), span: irSpan(action.authorize.span, file) },
    preconditions,
    effect: { kind: action.effect.kind, target: action.effect.target, entityId: entityId(effectEntity), assignments },
    lockPlan,
    span: irSpan(action.span, file),
    naming: { sqlFunction: snakeCase(action.name), typescriptMethod: action.name },
  };
}

function lowerQuery(query: QueryDecl, symbols: Symbols, principalName: string, file: string): IRQuery {
  const semanticId = queryId(query);
  const seen = new Map<string, Span>();
  const parameters: IRParameter[] = query.parameters.map((parameter) => {
    const previous = seen.get(parameter.name);
    if (previous) throw new ModelError("E2604", `Duplicate query parameter '${parameter.name}'.`, parameter.span, file, { message: "First declared here.", span: previous });
    seen.set(parameter.name, parameter.span);
    if (parameter.type.collection === "set") throw new ModelError("E2704", "Set-valued action and query parameters are not supported in 0.4.", parameter.type.span, file);
    if (!parameter.type.moneyCurrency && !scalars.has(parameter.type.name) && !symbols.enums.has(parameter.type.name) && !symbols.entities.has(parameter.type.name)) {
      throw new ModelError("E2005", `Unknown type '${parameter.type.name}'.`, parameter.type.span, file);
    }
    const type = resolvedType(parameter.type, symbols);
    return {
      id: `parameter:${semanticId}.${parameter.name}`,
      name: parameter.name,
      type,
      caller: parameter.caller,
      ...(parameter.caller ? { binding: "session_user" as const } : {}),
      span: irSpan(parameter.span, file),
      naming: { sqlParameter: `p_${snakeCase(parameter.name)}`, typescriptProperty: parameter.name },
    };
  });
  if (seen.has(query.rowAlias.name)) {
    throw new ModelError("E2605", `Query row alias '${query.rowAlias.name}' conflicts with a parameter.`, query.rowAlias.span, file);
  }
  const sourceEntity = symbols.entities.get(query.sourceType.name);
  if (!sourceEntity) {
    throw new ModelError("E2601", `Query source '${query.sourceType.name}' must be an entity.`, query.sourceType.span, file);
  }
  const parameterMap = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const caller = parameters.find((parameter) => parameter.caller)!;
  if (caller.type !== entityId(symbols.entities.get(principalName)!)) {
    throw new ModelError("E2304", "Caller principal type is inconsistent with the model.", query.span, file);
  }
  const authorization = typeExpression(query.authorize, {
    kind: "query",
    query,
    queryEntity: sourceEntity,
    rowAlias: query.rowAlias.name,
    allowQueryRow: false,
    parameters: parameterMap,
  }, symbols, file);
  requireBoolean(authorization, query.authorize.span, file, "Query authorization");
  const rowPolicy = typeExpression(query.where, {
    kind: "query",
    query,
    queryEntity: sourceEntity,
    rowAlias: query.rowAlias.name,
    allowQueryRow: true,
    parameters: parameterMap,
  }, symbols, file);
  requireBoolean(rowPolicy, query.where.span, file, "Query row policy");

  const [orderAlias, orderFieldName, extraOrderPart] = query.orderBy.path;
  if (extraOrderPart || query.orderBy.path.length !== 2 || orderAlias !== query.rowAlias.name) {
    throw new ModelError("E2606", `Query orderBy must be a direct field of row alias '${query.rowAlias.name}'.`, query.orderBy.span, file);
  }
  const orderField = symbols.fields.get(sourceEntity.name)!.get(orderFieldName!);
  if (!orderField) {
    throw new ModelError("E2607", `Unknown order field '${sourceEntity.name}.${orderFieldName}'.`, query.orderBy.span, file);
  }
  if (orderField.optional) {
    throw new ModelError("E2608", `Query order field '${sourceEntity.name}.${orderField.name}' must be required.`, query.orderBy.span, file);
  }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
    throw new ModelError("E2609", "Query limit must be an integer from 1 through 1000.", query.limitSpan, file);
  }

  return {
    id: semanticId,
    name: query.name,
    identity: identity(query.stableId),
    parameters,
    callerParameterId: caller.id,
    callableParameters: parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id),
    sourceEntityId: entityId(sourceEntity),
    rowAlias: query.rowAlias.name,
    authorization: {
      id: `authorize:${semanticId}`,
      name: "authorize",
      expression: authorization,
      sourceExpression: expressionText(query.authorize),
      span: irSpan(query.authorize.span, file),
    },
    rowPolicy: {
      id: `where:${semanticId}`,
      name: "where",
      expression: rowPolicy,
      sourceExpression: expressionText(query.where),
      span: irSpan(query.where.span, file),
    },
    orderBy: {
      fieldId: fieldId(sourceEntity, orderField),
      direction: query.orderBy.direction,
      identityTieBreaker: true,
    },
    limit: query.limit,
    span: irSpan(query.span, file),
    naming: { sqlFunction: snakeCase(query.name), typescriptMethod: query.name },
  };
}

function lowerWorkflows(
  symbols: Symbols,
  entities: IREntity[],
  enums: IREnum[],
  actions: IRAction[],
  file: string,
): IRWorkflow[] {
  const occupiedTargets = new Map<string, WorkflowDecl>();
  const result: IRWorkflow[] = [];
  for (const workflow of symbols.workflows.values()) {
    const entityDecl = symbols.entities.get(workflow.entityName);
    if (!entityDecl) {
      throw new ModelError("E3001", `Workflow '${workflow.name}' references unknown entity '${workflow.entityName}'.`, workflow.entitySpan, file);
    }
    const fieldDecl = symbols.fields.get(entityDecl.name)!.get(workflow.fieldName);
    if (!fieldDecl) {
      throw new ModelError("E3002", `Workflow '${workflow.name}' references unknown field '${entityDecl.name}.${workflow.fieldName}'.`, workflow.fieldSpan, file);
    }
    const enumerationDecl = symbols.enums.get(fieldDecl.type.name);
    if (!enumerationDecl || fieldDecl.type.collection || fieldDecl.optional) {
      throw new ModelError("E3003", `Workflow field '${entityDecl.name}.${fieldDecl.name}' must be a required enum field.`, fieldDecl.span, file);
    }
    const targetId = fieldId(entityDecl, fieldDecl);
    const previousWorkflow = occupiedTargets.get(targetId);
    if (previousWorkflow) {
      throw new ModelError("E3004", `Field '${entityDecl.name}.${fieldDecl.name}' already has workflow '${previousWorkflow.name}'.`, workflow.span, file);
    }
    occupiedTargets.set(targetId, workflow);

    const enumeration = enums.find((candidate) => candidate.id === enumId(enumerationDecl))!;
    const entity = entities.find((candidate) => candidate.id === entityId(entityDecl))!;
    const resolveMember = (
      reference: { enumName: string; memberName: string; span: Span },
      subject: string,
    ) => {
      if (reference.enumName !== enumerationDecl.name) {
        throw new ModelError("E3005", `${subject} must use enum '${enumerationDecl.name}', not '${reference.enumName}'.`, reference.span, file);
      }
      const declaration = enumerationDecl.members.find((candidate) => candidate.name === reference.memberName);
      if (!declaration) {
        throw new ModelError("E3006", `Unknown workflow state '${reference.enumName}.${reference.memberName}'.`, reference.span, file);
      }
      return enumeration.members.find((candidate) => candidate.id === enumMemberId(enumerationDecl, declaration))!;
    };
    const initial = resolveMember(workflow.initial, "Workflow initial state");
    const defaultValue = entity.fields.find((candidate) => candidate.id === targetId)!.default;
    if (defaultValue?.kind !== "enumLiteral" || defaultValue.memberId !== initial.id) {
      throw new ModelError("E3007", `Workflow field '${entityDecl.name}.${fieldDecl.name}' must default to its initial state '${workflow.initial.enumName}.${workflow.initial.memberName}'.`, fieldDecl.span, file);
    }

    const transitionNames = new Set<string>();
    const transitionEdges = new Set<string>();
    const transitionActions = new Set<string>();
    const transitions = workflow.transitions.map((transition) => {
      if (transitionNames.has(transition.name)) {
        throw new ModelError("E3008", `Duplicate transition name '${workflow.name}.${transition.name}'.`, transition.span, file);
      }
      transitionNames.add(transition.name);
      const from = resolveMember(transition.from, `Transition '${transition.name}' source`);
      const to = resolveMember(transition.to, `Transition '${transition.name}' destination`);
      if (from.id === to.id) {
        throw new ModelError("E3009", `Transition '${workflow.name}.${transition.name}' may not be a self-transition.`, transition.span, file);
      }
      const edge = `${from.id}->${to.id}`;
      if (transitionEdges.has(edge)) {
        throw new ModelError("E3010", `Workflow '${workflow.name}' declares the '${from.name}' to '${to.name}' edge more than once.`, transition.span, file);
      }
      transitionEdges.add(edge);
      const action = actions.find((candidate) => candidate.name === transition.actionName);
      if (!action) {
        throw new ModelError("E3011", `Transition '${workflow.name}.${transition.name}' references unknown action '${transition.actionName}'.`, transition.actionSpan, file);
      }
      if (transitionActions.has(action.id)) {
        throw new ModelError("E3012", `Action '${action.name}' may implement only one transition in workflow '${workflow.name}'.`, transition.actionSpan, file);
      }
      transitionActions.add(action.id);
      const assignment = action.effect.assignments.find((candidate) => candidate.fieldId === targetId);
      if (action.effect.kind !== "update" || action.effect.entityId !== entity.id || !assignment) {
        throw new ModelError("E3013", `Transition action '${action.name}' must update '${entity.name}.${fieldDecl.name}'.`, transition.actionSpan, file);
      }
      if (assignment.expression.kind !== "enumLiteral" || assignment.expression.memberId !== to.id) {
        throw new ModelError("E3014", `Transition action '${action.name}' must assign destination state '${to.name}'.`, transition.actionSpan, file);
      }
      const targetParameter = action.parameters.find((candidate) => candidate.name === action.effect.target);
      const guarded = Boolean(targetParameter && action.preconditions.some((precondition) =>
        isWorkflowSourceGuard(precondition.expression, targetParameter.id, targetId, from.id)));
      if (!guarded) {
        throw new ModelError("E3015", `Transition action '${action.name}' must have a named require asserting '${action.effect.target}.${fieldDecl.name} == ${enumerationDecl.name}.${from.name}'.`, transition.actionSpan, file);
      }
      return {
        id: transitionId(workflow, transition),
        name: transition.name,
        identity: identity(transition.stableId),
        fromMemberId: from.id,
        toMemberId: to.id,
        actionId: action.id,
        span: irSpan(transition.span, file),
      };
    });

    for (const action of actions) {
      if (action.effect.entityId !== entity.id) continue;
      const assignment = action.effect.assignments.find((candidate) => candidate.fieldId === targetId);
      if (action.effect.kind === "create") {
        if (assignment && (assignment.expression.kind !== "enumLiteral" || assignment.expression.memberId !== initial.id)) {
          throw new ModelError("E3016", `Create action '${action.name}' must initialize '${entity.name}.${fieldDecl.name}' to '${initial.name}'.`, symbols.actions.get(action.name)!.span, file);
        }
      } else if (assignment && !transitionActions.has(action.id)) {
        throw new ModelError("E3017", `Action '${action.name}' changes workflow field '${entity.name}.${fieldDecl.name}' but is not declared as a transition.`, symbols.actions.get(action.name)!.span, file);
      }
    }

    const reachable = new Set([initial.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const transition of transitions) {
        if (reachable.has(transition.fromMemberId) && !reachable.has(transition.toMemberId)) {
          reachable.add(transition.toMemberId);
          changed = true;
        }
      }
    }
    const unreachable = enumeration.members.filter((member) => !reachable.has(member.id));
    if (unreachable.length) {
      throw new ModelError("E3018", `Workflow '${workflow.name}' has unreachable state(s): ${unreachable.map((member) => member.name).join(", ")}.`, workflow.span, file);
    }

    const baseName = snakeCase(workflow.name);
    result.push({
      id: workflowId(workflow),
      name: workflow.name,
      identity: identity(workflow.stableId),
      entityId: entity.id,
      fieldId: targetId,
      enumId: enumeration.id,
      initialMemberId: initial.id,
      transitions,
      span: irSpan(workflow.span, file),
      naming: {
        sqlTriggerFunction: `enforce_${baseName}`,
        sqlInsertTrigger: `trg_${entity.naming.sqlTable}_${snakeCase(fieldDecl.name)}_workflow_insert`,
        sqlUpdateTrigger: `trg_${entity.naming.sqlTable}_${snakeCase(fieldDecl.name)}_workflow_update`,
        typescriptName: workflow.name,
      },
    });
  }
  return result;
}

function isWorkflowSourceGuard(
  expression: IRExpression,
  targetParameterId: string,
  fieldIdValue: string,
  sourceMemberId: string,
): boolean {
  if (expression.kind !== "binary" || expression.operator !== "==") return false;
  const matches = (field: IRExpression, member: IRExpression): boolean =>
    field.kind === "fieldAccess"
    && field.source === targetParameterId
    && field.fieldId === fieldIdValue
    && member.kind === "enumLiteral"
    && member.memberId === sourceMemberId;
  return matches(expression.left, expression.right) || matches(expression.right, expression.left);
}

function typeExpression(expression: Expression, scope: Scope, symbols: Symbols, file: string): IRExpression {
  if (expression.kind === "moneyLiteral") {
    const profile = moneyProfile(expression.currency);
    if (!profile) throw new ModelError("E2901", `Unsupported money currency '${expression.currency}'.`, expression.span, file);
    const invalid = validateMoneyAmount(expression.amount, profile);
    if (invalid) throw new ModelError("E2902", `Invalid ${expression.currency} money literal '${expression.amount}': ${invalid}.`, expression.span, file);
    return {
      kind: "moneyLiteral",
      currency: profile.currency,
      amount: expression.amount,
      precision: profile.precision,
      scale: profile.scale,
      type: moneyType(profile),
      nullable: false,
    };
  }
  if (expression.kind === "literal") {
    if (expression.literalKind === "null") return { kind: "nullLiteral", type: "null", nullable: true };
    const type = expression.literalKind === "number" ? (Number.isInteger(expression.value) ? "Int" : "Decimal")
      : expression.literalKind === "string" ? "String" : "Boolean";
    return { kind: "literal", value: expression.value as string | number | boolean, type, nullable: false };
  }
  if (expression.kind === "path") return typePath(expression, scope, symbols, file);
  if (expression.kind === "unary") {
    const operand = typeExpression(expression.operand, scope, symbols, file);
    requireBoolean(operand, expression.operand.span, file, "'not'");
    return { kind: "unary", operator: "not", operand, type: "Boolean", nullable: operand.nullable };
  }
  const left = typeExpression(expression.left, scope, symbols, file);
  const right = typeExpression(expression.right, scope, symbols, file);
  if (expression.operator === "and" || expression.operator === "or") {
    requireBoolean(left, expression.left.span, file, `'${expression.operator}'`);
    requireBoolean(right, expression.right.span, file, `'${expression.operator}'`);
    return { kind: "binary", operator: expression.operator, left, right, type: "Boolean", nullable: left.nullable || right.nullable };
  }
  if (expression.operator === "in") {
    if (!isEnumSetType(right.type) || left.type !== enumSetId(right.type)) {
      throw new ModelError("E2705", `Set membership requires a matching enum member and enum set, not ${left.type} in ${right.type}.`, expression.span, file);
    }
    return {
      kind: "binary",
      operator: "in",
      left,
      right,
      type: "Boolean",
      nullable: left.nullable || right.nullable,
      comparisonSemantics: "setMembership",
    };
  }
  if (left.kind === "nullLiteral" || right.kind === "nullLiteral") {
    const operand = left.kind === "nullLiteral" ? right : left;
    if (!["==", "!="].includes(expression.operator)) throw new ModelError("E2401", "null may only be used with == or !=.", expression.span, file);
    if (!operand.nullable) throw new ModelError("E2402", "null may only be compared with an optional value.", expression.span, file);
    return { kind: "nullComparison", operator: expression.operator === "==" ? "isNull" : "isNotNull", operand, type: "Boolean", nullable: false };
  }
  if (isEnumSetType(left.type) || isEnumSetType(right.type)) {
    throw new ModelError("E2706", "Enum sets support membership and null checks only; set equality and ordering are undefined in 0.4.", expression.span, file);
  }
  if (["<", "<=", ">", ">="].includes(expression.operator)) {
    const compatibleOrdering = (isNumeric(left.type) && isNumeric(right.type))
      || (left.type === "DateTime" && right.type === "DateTime")
      || (isMoneyType(left.type) && left.type === right.type);
    if (!compatibleOrdering) throw new ModelError("E2403", "Ordering comparisons require compatible numeric, DateTime, or same-currency Money operands.", expression.span, file);
  } else if (!compatibleTypes(left.type, right.type)) {
    throw new ModelError("E2404", `Cannot compare ${left.type} to ${right.type}.`, expression.span, file);
  }
  return {
    kind: "binary",
    operator: expression.operator,
    left,
    right,
    type: "Boolean",
    nullable: left.nullable || right.nullable,
    ...(["==", "!="].includes(expression.operator) && isEntityType(left.type) && isEntityType(right.type)
      ? { comparisonSemantics: "entityIdentity" as const }
      : {}),
  };
}

function typePath(expression: Extract<Expression, { kind: "path" }>, scope: Scope, symbols: Symbols, file: string): IRExpression {
  const [first, second, third] = expression.parts;
  if (third) throw new ModelError("E2405", "Transitive relationship traversal is not supported.", expression.span, file);
  const enumeration = first ? symbols.enums.get(first) : undefined;
  if (enumeration && second) {
    const member = enumeration.members.find((candidate) => candidate.name === second);
    if (expression.parts.length !== 2 || !member) {
      throw new ModelError("E2006", `Unknown enum member '${expression.parts.join(".")}'.`, expression.span, file);
    }
    return {
      kind: "enumLiteral",
      enumId: enumId(enumeration),
      memberId: enumMemberId(enumeration, member),
      memberName: member.name,
      type: enumId(enumeration),
      nullable: false,
    };
  }
  if (scope.kind === "invariant") {
    if (expression.parts.length !== 1) throw new ModelError("E2406", "Entity invariants may not dereference related entities.", expression.span, file);
    const field = symbols.fields.get(scope.entity!.name)!.get(first!);
    if (!field) throw new ModelError("E2007", `Unknown field '${scope.entity!.name}.${first}'.`, expression.span, file);
    return { kind: "fieldAccess", source: "self", fieldId: fieldId(scope.entity!, field), fieldName: field.name, type: fieldType(field, symbols), nullable: field.optional };
  }
  if (scope.kind === "query" && first === scope.rowAlias) {
    if (!scope.allowQueryRow) {
      throw new ModelError("E2610", `Query authorization may not reference row alias '${scope.rowAlias}'.`, expression.span, file);
    }
    if (expression.parts.length !== 2) {
      throw new ModelError("E2611", `Query row alias '${scope.rowAlias}' must be followed by a direct field.`, expression.span, file);
    }
    const field = symbols.fields.get(scope.queryEntity!.name)!.get(second!);
    if (!field) throw new ModelError("E2007", `Unknown field '${scope.queryEntity!.name}.${second}'.`, expression.span, file);
    return {
      kind: "fieldAccess",
      source: "queryRow",
      parameter: scope.rowAlias,
      fieldId: fieldId(scope.queryEntity!, field),
      fieldName: field.name,
      type: fieldType(field, symbols),
      nullable: field.optional,
    };
  }
  const parameter = scope.parameters!.get(first!);
  if (!parameter) {
    if (symbols.enums.has(first!)) throw new ModelError("E2008", "Enum members must be qualified.", expression.span, file);
    throw new ModelError("E2009", `Unknown parameter or enum '${first}'.`, expression.span, file);
  }
  if (!second) {
    if (isEntityType(parameter.type)) return { kind: "entityValue", parameterId: parameter.id, name: parameter.name, entityId: parameter.type, type: parameter.type, nullable: false };
    return { kind: "parameter", parameterId: parameter.id, name: parameter.name, type: parameter.type, nullable: false };
  }
  if (!isEntityType(parameter.type)) throw new ModelError("E2410", `Cannot access a field on non-entity parameter '${parameter.name}'.`, expression.span, file);
  const entity = entityForType(symbols, parameter.type);
  const field = symbols.fields.get(entity.name)!.get(second);
  if (!field) throw new ModelError("E2007", `Unknown field '${entity.name}.${second}'.`, expression.span, file);
  return { kind: "fieldAccess", source: parameter.id, parameter: parameter.name, fieldId: fieldId(entity, field), fieldName: field.name, type: fieldType(field, symbols), nullable: field.optional };
}

function compatibleTypes(left: string, right: string): boolean {
  return left === right || (isNumeric(left) && isNumeric(right));
}

function ensureAssignable(field: FieldDecl, expression: IRExpression, symbols: Symbols, span: Span, file: string): void {
  if (expression.kind === "nullLiteral") {
    if (!field.optional) throw new ModelError("E2411", `Cannot assign null to required field '${field.name}'.`, span, file);
    return;
  }
  const expected = fieldType(field, symbols);
  if (expected !== expression.type && !([expected, expression.type].every(isNumeric))) {
    throw new ModelError("E2412", `Cannot assign ${expression.type} to field '${field.name}' of type ${expected}.`, span, file);
  }
  if (!field.optional && expression.nullable) throw new ModelError("E2413", `Cannot assign nullable expression to required field '${field.name}'.`, span, file);
}

function requireBoolean(expression: IRExpression, span: Span, file: string, subject: string): void {
  if (expression.type !== "Boolean") throw new ModelError("E2414", `${subject} expression must be Boolean, not ${expression.type}.`, span, file);
}

function collectEntityParameters(expression: IRExpression, found: Set<string>): void {
  if (expression.kind === "entityValue") found.add(expression.parameterId);
  if (expression.kind === "fieldAccess" && expression.source.startsWith("parameter:")) found.add(expression.source);
  if (expression.kind === "unary") collectEntityParameters(expression.operand, found);
  if (expression.kind === "binary") {
    collectEntityParameters(expression.left, found);
    collectEntityParameters(expression.right, found);
  }
  if (expression.kind === "nullComparison") collectEntityParameters(expression.operand, found);
}

function buildEnforcement(
  enums: IREnum[],
  entities: IREntity[],
  actions: IRAction[],
  queries: IRQuery[],
  workflows: IRWorkflow[],
  schema: string,
  internalSchema: string,
): EnforcementEntry[] {
  const entries: EnforcementEntry[] = [{
    id: "boundary:principal_binding",
    purpose: "Bind a direct database session identity to the model principal through an owner-controlled table.",
    layer: "PostgreSQL session identity",
    artifact: "postgres/002_schema.sql",
    objectName: `${internalSchema}.principal_binding`,
  }, {
    id: "boundary:owner_role",
    purpose: "Generated objects are owned by a non-login role that application principals cannot assume.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_owner NOLOGIN",
  }, {
    id: "boundary:gateway_role",
    purpose: "Confine shared-credential identity activation to a dedicated non-login gateway role.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_gateway NOLOGIN",
  }, {
    id: "boundary:gateway_identity",
    purpose: "Resolve verified issuer and subject claims through an owner-controlled binding inside one transaction.",
    layer: "PostgreSQL transaction identity",
    artifact: "postgres/002_schema.sql",
    objectName: `${internalSchema}.gateway_principal_binding`,
  }, {
    id: "boundary:gateway_audit",
    purpose: "Record gateway issuer and subject provenance symmetrically with the resolved principal.",
    layer: "PostgreSQL audit",
    artifact: "postgres/002_schema.sql",
    objectName: `${internalSchema}.action_audit`,
  }, {
    id: "boundary:internal_schema",
    purpose: "Application principals cannot access principal bindings, audit storage, or migration history.",
    layer: "PostgreSQL privilege",
    artifact: "postgres/004_grants.sql",
    objectName: internalSchema,
  }, {
    id: "boundary:migration_history",
    purpose: "Record installed model/source identity, migration kind, and reviewed plan provenance for fail-closed evolution checks.",
    layer: "PostgreSQL migration history",
    artifact: "postgres/002_schema.sql",
    objectName: `${internalSchema}.schema_migrations`,
  }];
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.optional) entries.push({ id: `required:${field.id}`, purpose: `${field.name} is required.`, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: `${schema}.${entity.naming.sqlTable}.${field.naming.sqlColumn} NOT NULL`, source: field.span });
      if (isEntityType(field.type)) entries.push({ id: `reference:${field.id}`, purpose: `${field.name} references ${entities.find((candidate) => candidate.id === field.type)?.name ?? field.type}.`, layer: "PostgreSQL foreign key", artifact: "postgres/002_schema.sql", objectName: `fk_${entity.naming.sqlTable}_${field.naming.sqlColumn}`, source: field.span });
      if (isEnumType(field.type)) entries.push({ id: `enum-membership:${field.id}`, purpose: `${field.name} must be a declared ${enums.find((candidate) => candidate.id === field.type)?.name ?? field.type} member.`, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum`, source: field.span });
      if (isEnumSetType(field.type)) entries.push({ id: `enum-set:${field.id}`, purpose: `${field.name} is a duplicate-free set of declared ${enums.find((candidate) => candidate.id === enumSetId(field.type))?.name ?? enumSetId(field.type)} members.`, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum_set`, source: field.span });
      if (field.default) entries.push({ id: `default:${field.id}`, purpose: `Apply the declared constant default for ${field.name}.`, layer: "PostgreSQL column default", artifact: "postgres/002_schema.sql", objectName: `${schema}.${entity.naming.sqlTable}.${field.naming.sqlColumn}`, source: field.span });
      if (isMoneyType(field.type)) entries.push({ id: `money:${field.id}`, purpose: `Store ${field.name} as exact ${field.type.split(":")[1]} money within its declared precision and scale.`, layer: "PostgreSQL money constraint", artifact: "postgres/002_schema.sql", objectName: `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_money`, source: field.span });
      if (field.storage === "snapshot") entries.push({ id: `snapshot:${field.id}`, purpose: `${field.name} is a stored point-in-time audit snapshot, not a live relationship-derived value.`, layer: "ModelLang storage semantics", artifact: "model.ir.json", objectName: field.id, source: field.span });
      if (field.generation) entries.push({ id: `generated:${field.id}`, purpose: `Generate ${field.name} with ${field.generation.strategy} under database authority.`, layer: "PostgreSQL column default", artifact: "postgres/002_schema.sql", objectName: `${schema}.${entity.naming.sqlTable}.${field.naming.sqlColumn}`, source: field.span });
      if (field.mutability === "immutable") entries.push({ id: `immutable:${field.id}`, purpose: `Prevent action updates to immutable field ${field.name}.`, layer: "ModelLang action semantics", artifact: "model.ir.json", objectName: field.id, source: field.span });
      for (const annotation of field.annotations) {
        if (annotation.name === "snapshot" || annotation.name === "generated" || annotation.name === "immutable") continue;
        entries.push({
          id: `annotation:${field.id}.${annotation.name}`,
          purpose: `Enforce @${annotation.name}${annotation.value === undefined ? "" : `(${annotation.value})`}.`,
          layer: annotation.name === "id" ? "PostgreSQL primary key" : "PostgreSQL constraint",
          artifact: "postgres/002_schema.sql",
          objectName: annotation.name === "id" ? `${entity.naming.sqlTable}_pkey` : `${annotation.name === "unique" ? "uq" : "ck"}_${entity.naming.sqlTable}_${field.naming.sqlColumn}_${snakeCase(annotation.name)}`,
          source: field.span,
        });
      }
    }
    for (const invariant of entity.invariants) entries.push({ id: invariant.id, purpose: invariant.sourceExpression, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: invariant.naming.sqlConstraint, source: invariant.span });
    for (const exclusion of entity.temporalExclusions) {
      entries.push({
        id: exclusion.id,
        purpose: `${exclusion.sourceExpression} rejects overlapping half-open intervals for the same key.`,
        layer: "PostgreSQL exclusion constraint",
        artifact: "postgres/002_schema.sql",
        objectName: exclusion.naming.sqlExclusionConstraint,
        source: exclusion.span,
      });
      entries.push({
        id: `derived:${exclusion.id}.valid_interval`,
        purpose: "Require interval start to be strictly before interval end.",
        layer: "PostgreSQL check constraint",
        artifact: "postgres/002_schema.sql",
        objectName: exclusion.naming.sqlValidIntervalConstraint,
        source: exclusion.span,
      });
    }
    entries.push({ id: `boundary:${entity.id}.direct_write`, purpose: "Application principals cannot directly mutate entity rows.", layer: "PostgreSQL privilege", artifact: "postgres/004_grants.sql", objectName: `${schema}.${entity.naming.sqlTable}`, source: entity.span });
    entries.push({ id: `boundary:${entity.id}.direct_read`, purpose: "Application principals cannot directly read entity rows outside generated queries.", layer: "PostgreSQL privilege", artifact: "postgres/004_grants.sql", objectName: `${schema}.${entity.naming.sqlTable}`, source: entity.span });
  }
  for (const action of actions) {
    const fn = `${schema}.${action.naming.sqlFunction}`;
    const caller = action.parameters.find((parameter) => parameter.id === action.callerParameterId)!;
    entries.push({ id: `caller:${action.id}.${caller.name}`, purpose: "Resolve the semantic caller from direct session identity or transaction-bound gateway claims; no caller UUID is accepted.", layer: "PostgreSQL authenticated identity", artifact: "postgres/003_actions.sql", objectName: fn, source: caller.span });
    for (const parameter of action.parameters.filter((candidate) => isMoneyType(candidate.type))) {
      entries.push({ id: `money-parameter:${parameter.id}`, purpose: `Validate ${parameter.name} against its exact currency, precision, and scale contract.`, layer: "PostgreSQL action input validation", artifact: "postgres/003_actions.sql", objectName: fn, source: parameter.span });
    }
    entries.push({ id: `boundary:${action.id}.safe_search_path`, purpose: "Prevent caller-controlled object shadowing inside the privileged function.", layer: "PostgreSQL function configuration", artifact: "postgres/003_actions.sql", objectName: `${fn} search_path=pg_catalog,pg_temp` });
    entries.push({ id: action.authorization.id, purpose: action.authorization.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: action.authorization.span });
    for (const precondition of action.preconditions) entries.push({ id: precondition.id, purpose: precondition.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: precondition.span });
    entries.push({ id: `effect:${action.id}`, purpose: `${action.effect.kind} ${action.effect.entityId}.`, layer: "PostgreSQL action function", artifact: "postgres/003_actions.sql", objectName: fn, source: action.span });
    for (const lock of action.lockPlan) entries.push({ id: lock.id, purpose: `Stabilize ${lock.source} before evaluating guards and effects.`, layer: "PostgreSQL row lock", artifact: "postgres/003_actions.sql", objectName: `${lock.mode === "update" ? "FOR UPDATE" : "FOR SHARE"} in ${fn}` });
  }
  for (const query of queries) {
    const fn = `${schema}.${query.naming.sqlFunction}`;
    const caller = query.parameters.find((parameter) => parameter.id === query.callerParameterId)!;
    entries.push({ id: `caller:${query.id}.${caller.name}`, purpose: "Resolve the semantic caller from direct session identity or transaction-bound gateway claims; no caller UUID is accepted.", layer: "PostgreSQL authenticated identity", artifact: "postgres/003_queries.sql", objectName: fn, source: caller.span });
    for (const parameter of query.parameters.filter((candidate) => isMoneyType(candidate.type))) {
      entries.push({ id: `money-parameter:${parameter.id}`, purpose: `Validate ${parameter.name} against its exact currency, precision, and scale contract.`, layer: "PostgreSQL query input validation", artifact: "postgres/003_queries.sql", objectName: fn, source: parameter.span });
    }
    entries.push({ id: `boundary:${query.id}.safe_search_path`, purpose: "Prevent caller-controlled object shadowing inside the privileged function.", layer: "PostgreSQL function configuration", artifact: "postgres/003_queries.sql", objectName: `${fn} search_path=pg_catalog,pg_temp` });
    entries.push({ id: query.authorization.id, purpose: query.authorization.sourceExpression, layer: "PostgreSQL query guard", artifact: "postgres/003_queries.sql", objectName: fn, source: query.authorization.span });
    entries.push({ id: query.rowPolicy.id, purpose: query.rowPolicy.sourceExpression, layer: "PostgreSQL row policy", artifact: "postgres/003_queries.sql", objectName: fn, source: query.rowPolicy.span });
    entries.push({ id: `order:${query.id}`, purpose: "Return rows in the declared order with an ascending identity tie-breaker.", layer: "PostgreSQL query function", artifact: "postgres/003_queries.sql", objectName: fn, source: query.span });
    entries.push({ id: `limit:${query.id}`, purpose: `Return at most ${query.limit} rows.`, layer: "PostgreSQL query function", artifact: "postgres/003_queries.sql", objectName: fn, source: query.span });
    entries.push({ id: `read:${query.id}`, purpose: `Read ${query.sourceEntityId} through the generated query boundary.`, layer: "PostgreSQL query function", artifact: "postgres/003_queries.sql", objectName: fn, source: query.span });
  }
  for (const workflow of workflows) {
    entries.push({
      id: `workflow-initial:${workflow.id}`,
      purpose: `Require new ${workflow.entityId} rows to begin in the declared initial state.`,
      layer: "PostgreSQL workflow trigger",
      artifact: "postgres/002_schema.sql",
      objectName: workflow.naming.sqlInsertTrigger,
      source: workflow.span,
    });
    for (const transition of workflow.transitions) {
      entries.push({
        id: transition.id,
        purpose: `Permit only the declared workflow edge implemented by ${transition.actionId}.`,
        layer: "PostgreSQL workflow trigger",
        artifact: "postgres/002_schema.sql",
        objectName: workflow.naming.sqlUpdateTrigger,
        source: transition.span,
      });
    }
  }
  entries.push({ id: "boundary:audit", purpose: "Record each successful action with database and model principal identities plus gateway provenance when present.", layer: "PostgreSQL audit", artifact: "postgres/003_actions.sql", objectName: `${internalSchema}.action_audit` });
  return entries;
}
