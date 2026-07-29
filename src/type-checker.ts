import { createHash } from "node:crypto";
import { ModelError, type Span } from "./diagnostics.js";
import type { IRAction, IREntity, IRExpression, IRField, IRLock, IRParameter, IRSpan, ModelIR, EnforcementEntry } from "./ir.js";
import { snakeCase } from "./naming.js";
import type {
  ActionDecl, Declaration, EntityDecl, Expression, FieldDecl, Program,
} from "./syntax-ast.js";

const scalars = new Set(["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"]);

interface Scope {
  kind: "invariant" | "action";
  entity?: EntityDecl;
  action?: ActionDecl;
  parameters?: Map<string, IRParameter>;
}

interface Symbols {
  enums: Map<string, Extract<Declaration, { kind: "enum" }>>;
  entities: Map<string, EntityDecl>;
  actions: Map<string, ActionDecl>;
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
    case "path": return expression.parts.join(".");
    case "unary": return `not ${expressionText(expression.operand)}`;
    case "binary": return `(${expressionText(expression.left)} ${expression.operator} ${expressionText(expression.right)})`;
  }
}

function isEntityType(type: string): boolean { return type.startsWith("entity:"); }
function isEnumType(type: string): boolean { return type.startsWith("enum:"); }
function entityName(type: string): string { return type.slice("entity:".length); }
function isNumeric(type: string): boolean { return type === "Int" || type === "Decimal"; }

export function analyze(program: Program, source: string, file: string): ModelIR {
  const symbols = collectSymbols(program, file);
  validateEntities(symbols, file);
  const principalNames = new Set<string>();
  for (const action of symbols.actions.values()) {
    const callers = action.parameters.filter((parameter) => parameter.caller);
    if (callers.length !== 1) throw new ModelError("E2301", `Action '${action.name}' must declare exactly one caller parameter.`, action.span, file);
    const caller = callers[0]!;
    if (!symbols.entities.has(caller.type.name)) throw new ModelError("E2302", `Caller '${caller.name}' must have an entity type.`, caller.type.span, file);
    principalNames.add(caller.type.name);
  }
  if (symbols.actions.size === 0) throw new ModelError("E2303", "A model must declare at least one action to establish its principal type.", program.model.span, file);
  if (principalNames.size !== 1) throw new ModelError("E2304", "All actions must use the same principal entity type.", program.model.span, file);
  const principalName = [...principalNames][0]!;
  const schema = `model_${snakeCase(program.model.name)}`;
  const internalSchema = `${schema}_internal`;

  const enums = [...symbols.enums.values()].map((declaration) => ({
    id: `enum:${declaration.name}`,
    name: declaration.name,
    members: declaration.members.map((member) => member.name),
    span: irSpan(declaration.span, file),
    naming: { sqlCheckPrefix: `ck_enum_${snakeCase(declaration.name)}`, typescriptName: declaration.name },
  }));
  const entities: IREntity[] = [...symbols.entities.values()].map((entity) => lowerEntity(entity, symbols, file));
  const actions: IRAction[] = [...symbols.actions.values()].map((action) => lowerAction(action, symbols, principalName, file));
  const enforcement = buildEnforcement(entities, actions, schema, internalSchema);
  return {
    irVersion: 1,
    model: {
      id: `model:${program.model.name}`,
      name: program.model.name,
      version: program.model.version,
      sourceHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
      sourceFile: file,
      naming: { sqlSchema: schema, internalSchema },
    },
    principal: { entityId: `entity:${principalName}`, bindingMechanism: "session_user" },
    enums,
    entities,
    actions,
    enforcement,
  };
}

function collectSymbols(program: Program, file: string): Symbols {
  const enums = new Map<string, Extract<Declaration, { kind: "enum" }>>();
  const entities = new Map<string, EntityDecl>();
  const actions = new Map<string, ActionDecl>();
  const top = new Map<string, Declaration>();
  for (const declaration of program.declarations) {
    const previous = top.get(declaration.name);
    if (previous) throw new ModelError("E2001", `Duplicate declaration '${declaration.name}'.`, declaration.span, file, { message: "First declared here.", span: previous.span });
    top.set(declaration.name, declaration);
    if (declaration.kind === "enum") enums.set(declaration.name, declaration);
    if (declaration.kind === "entity") entities.set(declaration.name, declaration);
    if (declaration.kind === "action") actions.set(declaration.name, declaration);
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
    const invariantNames = new Set<string>();
    for (const member of entity.members) {
      if (member.kind === "field") {
        const previous = entityFields.get(member.name);
        if (previous) throw new ModelError("E2003", `Duplicate field '${entity.name}.${member.name}'.`, member.span, file, { message: "First declared here.", span: previous.span });
        entityFields.set(member.name, member);
      } else {
        if (invariantNames.has(member.name)) throw new ModelError("E2004", `Duplicate invariant '${entity.name}.${member.name}'.`, member.span, file);
        invariantNames.add(member.name);
      }
    }
    fields.set(entity.name, entityFields);
  }
  return { enums, entities, actions, fields };
}

function validateEntities(symbols: Symbols, file: string): void {
  for (const entity of symbols.entities.values()) {
    const fields = [...symbols.fields.get(entity.name)!.values()];
    const ids = fields.filter((field) => field.annotations.some((annotation) => annotation.name === "id"));
    if (ids.length !== 1) throw new ModelError("E2201", `Entity '${entity.name}' must have exactly one @id field.`, entity.span, file);
    const id = ids[0]!;
    if (id.type.name !== "UUID" || id.optional) throw new ModelError("E2202", `The @id field '${entity.name}.${id.name}' must be required UUID.`, id.span, file);
    for (const field of fields) {
      if (!scalars.has(field.type.name) && !symbols.enums.has(field.type.name) && !symbols.entities.has(field.type.name)) {
        throw new ModelError("E2005", `Unknown type '${field.type.name}'.`, field.type.span, file);
      }
      const annotationNames = new Set<string>();
      for (const annotation of field.annotations) {
        if (annotationNames.has(annotation.name)) throw new ModelError("E2203", `Duplicate @${annotation.name} annotation.`, annotation.span, file);
        annotationNames.add(annotation.name);
        if ((annotation.name === "min" || annotation.name === "minExclusive" || annotation.name === "max") && !["Int", "Decimal"].includes(field.type.name)) {
          throw new ModelError("E2204", `@${annotation.name} is valid only on Int and Decimal fields.`, annotation.span, file);
        }
        if (annotation.name === "unique" && field.optional) throw new ModelError("E2205", "@unique is not supported on optional fields.", annotation.span, file);
        if (annotation.name === "snapshot" && symbols.entities.has(field.type.name)) {
          throw new ModelError("E2207", "@snapshot is for stored scalar or enum audit values, not entity references.", annotation.span, file);
        }
      }
      if (field.default) {
        if (!isCompileTimeConstant(field.default, symbols)) throw new ModelError("E2206", "Field defaults must be compile-time constants.", field.default.span, file);
        const typed = typeExpression(field.default, { kind: "invariant", entity }, symbols, file);
        ensureAssignable(field, typed, field.default.span, file);
      }
    }
  }
}

function isCompileTimeConstant(expression: Expression, symbols: Symbols): boolean {
  return expression.kind === "literal"
    || (expression.kind === "path" && expression.parts.length === 2 && Boolean(symbols.enums.get(expression.parts[0]!)?.members.some((member) => member.name === expression.parts[1])));
}

function fieldType(field: FieldDecl, symbols: Symbols): string {
  if (symbols.entities.has(field.type.name)) return `entity:${field.type.name}`;
  if (symbols.enums.has(field.type.name)) return `enum:${field.type.name}`;
  return field.type.name;
}

function lowerEntity(entity: EntityDecl, symbols: Symbols, file: string): IREntity {
  const fields: IRField[] = entity.members.filter((member): member is FieldDecl => member.kind === "field").map((field) => ({
    id: `field:${entity.name}.${field.name}`,
    name: field.name,
    type: fieldType(field, symbols),
    optional: field.optional,
    default: field.default ? typeExpression(field.default, { kind: "invariant", entity }, symbols, file) : undefined,
    annotations: field.annotations.map(({ name, value }) => ({ name, ...(value === undefined ? {} : { value }) })),
    storage: field.annotations.some((annotation) => annotation.name === "snapshot") ? "snapshot" : "ordinary",
    span: irSpan(field.span, file),
    naming: { sqlColumn: isEntityType(fieldType(field, symbols)) ? `${snakeCase(field.name)}_id` : snakeCase(field.name) },
  }));
  const id = fields.find((field) => field.annotations.some((annotation) => annotation.name === "id"))!;
  const invariants = entity.members.filter((member) => member.kind === "invariant").map((invariant) => {
    const expression = typeExpression(invariant.expression, { kind: "invariant", entity }, symbols, file);
    requireBoolean(expression, invariant.expression.span, file, "Invariant");
    return {
      id: `invariant:${entity.name}.${invariant.name}`,
      name: invariant.name,
      expression,
      sourceExpression: expressionText(invariant.expression),
      span: irSpan(invariant.span, file),
      naming: { sqlConstraint: `ck_${snakeCase(entity.name)}_${snakeCase(invariant.name)}` },
    };
  });
  return {
    id: `entity:${entity.name}`,
    name: entity.name,
    fields,
    invariants,
    idFieldId: id.id,
    span: irSpan(entity.span, file),
    naming: { sqlTable: snakeCase(entity.name), typescriptName: entity.name },
  };
}

function lowerAction(action: ActionDecl, symbols: Symbols, principalName: string, file: string): IRAction {
  const seen = new Map<string, Span>();
  const parameters: IRParameter[] = action.parameters.map((parameter) => {
    const previous = seen.get(parameter.name);
    if (previous) throw new ModelError("E2305", `Duplicate parameter '${parameter.name}'.`, parameter.span, file, { message: "First declared here.", span: previous });
    seen.set(parameter.name, parameter.span);
    if (!scalars.has(parameter.type.name) && !symbols.enums.has(parameter.type.name) && !symbols.entities.has(parameter.type.name)) {
      throw new ModelError("E2005", `Unknown type '${parameter.type.name}'.`, parameter.type.span, file);
    }
    const type = symbols.entities.has(parameter.type.name) ? `entity:${parameter.type.name}` : symbols.enums.has(parameter.type.name) ? `enum:${parameter.type.name}` : parameter.type.name;
    return {
      id: `parameter:${action.name}.${parameter.name}`,
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
  if (caller.type !== `entity:${principalName}`) throw new ModelError("E2304", "Caller principal type is inconsistent with the model.", action.span, file);
  const scope: Scope = { kind: "action", action, parameters: parameterMap };
  const authorization = typeExpression(action.authorize, scope, symbols, file);
  requireBoolean(authorization, action.authorize.span, file, "Authorization");
  const preconditionNames = new Set<string>();
  const preconditions = action.requires.map((requirement) => {
    if (preconditionNames.has(requirement.name)) throw new ModelError("E2306", `Duplicate precondition '${requirement.name}'.`, requirement.span, file);
    preconditionNames.add(requirement.name);
    const expression = typeExpression(requirement.expression, scope, symbols, file);
    requireBoolean(expression, requirement.expression.span, file, "Precondition");
    return { id: `require:${action.name}.${requirement.name}`, name: requirement.name, expression, sourceExpression: expressionText(requirement.expression), span: irSpan(requirement.span, file) };
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
    effectEntity = symbols.entities.get(entityName(targetParameter.type))!;
  }
  if (returnEntity.name !== effectEntity.name) throw new ModelError("E2311", "Action return type must match the created or updated entity.", action.returnType.span, file);
  const effectFields = symbols.fields.get(effectEntity.name)!;
  const assigned = new Set<string>();
  const assignments = action.effect.assignments.map((assignment) => {
    if (assigned.has(assignment.field)) throw new ModelError("E2312", `Field '${assignment.field}' is assigned more than once.`, assignment.span, file);
    assigned.add(assignment.field);
    const field = effectFields.get(assignment.field);
    if (!field) throw new ModelError("E2313", `Unknown field '${effectEntity.name}.${assignment.field}'.`, assignment.span, file);
    if (action.effect.kind === "update" && field.annotations.some((annotation) => annotation.name === "id")) {
      throw new ModelError("E2314", "An update may not change an @id field.", assignment.span, file);
    }
    const expression = typeExpression(assignment.expression, scope, symbols, file);
    ensureAssignable(field, expression, assignment.expression.span, file);
    if (field.annotations.some((annotation) => annotation.name === "snapshot")
      && expression.kind !== "nullLiteral"
      && expression.kind !== "fieldAccess") {
      throw new ModelError("E2415", `@snapshot field '${field.name}' must be assigned null or a direct field value.`, assignment.expression.span, file);
    }
    return { fieldId: `field:${effectEntity.name}.${field.name}`, fieldName: field.name, expression };
  });
  if (action.effect.kind === "create") {
    for (const field of effectFields.values()) {
      if (!field.optional && !field.default && !assigned.has(field.name)) {
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
    locks.push({ id: `lock:${action.name}.${targetParameter.name}`, source: targetParameter.id, parameterId: targetParameter.id, entityId: targetParameter.type, mode: "update" });
    usedParameters.delete(targetParameter.id);
  }
  for (const parameterId of usedParameters) {
    const parameter = parameters.find((candidate) => candidate.id === parameterId)!;
    locks.push({
      id: `lock:${action.name}.${parameter.name}`,
      source: parameter.caller ? "caller" : parameter.id,
      parameterId: parameter.id,
      entityId: parameter.type,
      mode: "share",
    });
  }
  locks.sort((left, right) => left.entityId.localeCompare(right.entityId) || left.source.localeCompare(right.source));
  const lockPlan = locks.map((lock, order) => ({ ...lock, order }));
  return {
    id: `action:${action.name}`,
    name: action.name,
    parameters,
    callerParameterId: caller.id,
    callableParameters: parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id),
    returnEntityId: `entity:${returnEntity.name}`,
    authorization: { id: `authorize:${action.name}`, name: "authorize", expression: authorization, sourceExpression: expressionText(action.authorize), span: irSpan(action.authorize.span, file) },
    preconditions,
    effect: { kind: action.effect.kind, target: action.effect.target, entityId: `entity:${effectEntity.name}`, assignments },
    lockPlan,
    span: irSpan(action.span, file),
    naming: { sqlFunction: snakeCase(action.name), typescriptMethod: action.name },
  };
}

function typeExpression(expression: Expression, scope: Scope, symbols: Symbols, file: string): IRExpression {
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
  if (left.kind === "nullLiteral" || right.kind === "nullLiteral") {
    const operand = left.kind === "nullLiteral" ? right : left;
    if (!["==", "!="].includes(expression.operator)) throw new ModelError("E2401", "null may only be used with == or !=.", expression.span, file);
    if (!operand.nullable) throw new ModelError("E2402", "null may only be compared with an optional value.", expression.span, file);
    return { kind: "nullComparison", operator: expression.operator === "==" ? "isNull" : "isNotNull", operand, type: "Boolean", nullable: false };
  }
  if (["<", "<=", ">", ">="].includes(expression.operator)) {
    if (!isNumeric(left.type) || !isNumeric(right.type)) throw new ModelError("E2403", "Ordering comparisons require numeric operands.", expression.span, file);
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
    if (expression.parts.length !== 2 || !enumeration.members.some((member) => member.name === second)) {
      throw new ModelError("E2006", `Unknown enum member '${expression.parts.join(".")}'.`, expression.span, file);
    }
    return { kind: "enumLiteral", enumId: `enum:${first}`, member: second, type: `enum:${first}`, nullable: false };
  }
  if (scope.kind === "invariant") {
    if (expression.parts.length !== 1) throw new ModelError("E2406", "Entity invariants may not dereference related entities.", expression.span, file);
    const field = symbols.fields.get(scope.entity!.name)!.get(first!);
    if (!field) throw new ModelError("E2007", `Unknown field '${scope.entity!.name}.${first}'.`, expression.span, file);
    return { kind: "fieldAccess", source: "self", fieldId: `field:${scope.entity!.name}.${field.name}`, fieldName: field.name, type: fieldType(field, symbols), nullable: field.optional };
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
  const entity = entityName(parameter.type);
  const field = symbols.fields.get(entity)!.get(second);
  if (!field) throw new ModelError("E2007", `Unknown field '${entity}.${second}'.`, expression.span, file);
  return { kind: "fieldAccess", source: parameter.id, parameter: parameter.name, fieldId: `field:${entity}.${field.name}`, fieldName: field.name, type: fieldType(field, symbols), nullable: field.optional };
}

function compatibleTypes(left: string, right: string): boolean {
  return left === right || (isNumeric(left) && isNumeric(right));
}

function ensureAssignable(field: FieldDecl, expression: IRExpression, span: Span, file: string): void {
  if (expression.kind === "nullLiteral") {
    if (!field.optional) throw new ModelError("E2411", `Cannot assign null to required field '${field.name}'.`, span, file);
    return;
  }
  const expected = field.type.name;
  const actual = isEntityType(expression.type) ? entityName(expression.type) : isEnumType(expression.type) ? expression.type.slice(5) : expression.type;
  if (expected !== actual && !(["Int", "Decimal"].includes(expected) && isNumeric(expression.type))) {
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

function buildEnforcement(entities: IREntity[], actions: IRAction[], schema: string, internalSchema: string): EnforcementEntry[] {
  const entries: EnforcementEntry[] = [{
    id: "boundary:principal_binding",
    purpose: "Bind session_user to the model principal through an owner-controlled table.",
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
    id: "boundary:internal_schema",
    purpose: "Application principals cannot access principal bindings or audit storage.",
    layer: "PostgreSQL privilege",
    artifact: "postgres/004_grants.sql",
    objectName: internalSchema,
  }];
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.optional) entries.push({ id: `required:${entity.name}.${field.name}`, purpose: `${field.name} is required.`, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: `${schema}.${entity.naming.sqlTable}.${field.naming.sqlColumn} NOT NULL`, source: field.span });
      if (isEntityType(field.type)) entries.push({ id: `reference:${entity.name}.${field.name}`, purpose: `${field.name} references ${entityName(field.type)}.`, layer: "PostgreSQL foreign key", artifact: "postgres/002_schema.sql", objectName: `fk_${entity.naming.sqlTable}_${field.naming.sqlColumn}`, source: field.span });
      if (isEnumType(field.type)) entries.push({ id: `enum-membership:${entity.name}.${field.name}`, purpose: `${field.name} must be a declared ${field.type.slice(5)} member.`, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: `ck_${entity.naming.sqlTable}_${field.naming.sqlColumn}_enum`, source: field.span });
      if (field.default) entries.push({ id: `default:${entity.name}.${field.name}`, purpose: `Apply the declared constant default for ${field.name}.`, layer: "PostgreSQL column default", artifact: "postgres/002_schema.sql", objectName: `${schema}.${entity.naming.sqlTable}.${field.naming.sqlColumn}`, source: field.span });
      if (field.storage === "snapshot") entries.push({ id: `snapshot:${entity.name}.${field.name}`, purpose: `${field.name} is a stored point-in-time audit snapshot, not a live relationship-derived value.`, layer: "ModelLang storage semantics", artifact: "model.ir.json", objectName: field.id, source: field.span });
      for (const annotation of field.annotations) {
        if (annotation.name === "snapshot") continue;
        entries.push({
          id: `annotation:${entity.name}.${field.name}.${annotation.name}`,
          purpose: `Enforce @${annotation.name}${annotation.value === undefined ? "" : `(${annotation.value})`}.`,
          layer: annotation.name === "id" ? "PostgreSQL primary key" : "PostgreSQL constraint",
          artifact: "postgres/002_schema.sql",
          objectName: annotation.name === "id" ? `${entity.naming.sqlTable}_pkey` : `${annotation.name === "unique" ? "uq" : "ck"}_${entity.naming.sqlTable}_${field.naming.sqlColumn}_${snakeCase(annotation.name)}`,
          source: field.span,
        });
      }
    }
    for (const invariant of entity.invariants) entries.push({ id: invariant.id, purpose: invariant.sourceExpression, layer: "PostgreSQL constraint", artifact: "postgres/002_schema.sql", objectName: invariant.naming.sqlConstraint, source: invariant.span });
    entries.push({ id: `boundary:${entity.name}.direct_write`, purpose: "Application principals cannot directly mutate entity rows.", layer: "PostgreSQL privilege", artifact: "postgres/004_grants.sql", objectName: `${schema}.${entity.naming.sqlTable}`, source: entity.span });
  }
  for (const action of actions) {
    const fn = `${schema}.${action.naming.sqlFunction}`;
    const caller = action.parameters.find((parameter) => parameter.id === action.callerParameterId)!;
    entries.push({ id: `caller:${action.name}.${caller.name}`, purpose: "Derive the semantic caller from session_user; no caller UUID is accepted.", layer: "PostgreSQL session identity", artifact: "postgres/003_actions.sql", objectName: fn, source: caller.span });
    entries.push({ id: `boundary:${action.name}.safe_search_path`, purpose: "Prevent caller-controlled object shadowing inside the privileged function.", layer: "PostgreSQL function configuration", artifact: "postgres/003_actions.sql", objectName: `${fn} search_path=pg_catalog,pg_temp` });
    entries.push({ id: action.authorization.id, purpose: action.authorization.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: action.authorization.span });
    for (const precondition of action.preconditions) entries.push({ id: precondition.id, purpose: precondition.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: precondition.span });
    entries.push({ id: `effect:${action.name}`, purpose: `${action.effect.kind} ${action.effect.entityId}.`, layer: "PostgreSQL action function", artifact: "postgres/003_actions.sql", objectName: fn, source: action.span });
    for (const lock of action.lockPlan) entries.push({ id: lock.id, purpose: `Stabilize ${lock.source} before evaluating guards and effects.`, layer: "PostgreSQL row lock", artifact: "postgres/003_actions.sql", objectName: `${lock.mode === "update" ? "FOR UPDATE" : "FOR SHARE"} in ${fn}` });
  }
  entries.push({ id: "boundary:audit", purpose: "Record each successful action with database and model principal identities.", layer: "PostgreSQL audit", artifact: "postgres/003_actions.sql", objectName: `${internalSchema}.action_audit` });
  return entries;
}
