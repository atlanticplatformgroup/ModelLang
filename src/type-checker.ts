import { createHash } from "node:crypto";
import { ModelError, type Span } from "./diagnostics.js";
import type { IRAction, IRConsumer, IREntity, IREnum, IREvent, IRExpression, IRField, IRIdentity, IRLock, IRParameter, IRPolicy, IRProjection, IRQuery, IRSpan, IRWorkflow, ModelIR, EnforcementEntry } from "./ir.js";
import { isMoneyType, moneyProfile, moneyType, validateMoneyAmount } from "./money.js";
import { snakeCase } from "./naming.js";
import { decisionFunctionName, decisionRevisionRuleId } from "./decision-plan.js";
import type {
  ActionDecl, Annotation, ConsumerDecl, Declaration, EntityDecl, EventDecl, ExclusionDecl, Expression, FieldDecl, InvariantDecl, PolicyDecl, Program, ProjectionDecl, QueryDecl, TypeRef,
  WorkflowDecl,
} from "./syntax-ast.js";

const scalars = new Set(["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"]);

interface Scope {
  kind: "invariant" | "policy" | "action" | "consumer" | "query";
  entity?: EntityDecl;
  action?: ActionDecl;
  consumer?: ConsumerDecl;
  query?: QueryDecl;
  policy?: PolicyDecl;
  queryEntity?: EntityDecl;
  rowAlias?: string;
  allowQueryRow?: boolean;
  parameters?: Map<string, IRParameter>;
}

interface Symbols {
  enums: Map<string, Extract<Declaration, { kind: "enum" }>>;
  entities: Map<string, EntityDecl>;
  projections: Map<string, ProjectionDecl>;
  events: Map<string, EventDecl>;
  policies: Map<string, PolicyDecl>;
  actions: Map<string, ActionDecl>;
  consumers: Map<string, ConsumerDecl>;
  queries: Map<string, QueryDecl>;
  workflows: Map<string, WorkflowDecl>;
  fields: Map<string, Map<string, FieldDecl>>;
  loweredPolicies: Map<string, IRPolicy>;
  policyStack: string[];
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
    case "call": return `${expression.name}(${expression.arguments.map(expressionText).join(", ")})`;
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

function projectionId(projection: ProjectionDecl): string {
  return `projection:${String(projection.stableId?.value ?? projection.name)}`;
}

function projectionFieldId(projection: ProjectionDecl, field: ProjectionDecl["fields"][number]): string {
  return `projectionField:${String(field.stableId?.value ?? `${projection.name}.${field.name}`)}`;
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

function eventId(event: EventDecl): string {
  return `event:${String(event.stableId?.value ?? event.name)}`;
}

function consumerId(consumer: ConsumerDecl): string {
  return `consumer:${String(consumer.stableId?.value ?? consumer.name)}`;
}

function policyId(policy: PolicyDecl): string {
  return `policy:${String(policy.stableId?.value ?? policy.name)}`;
}

function policyBranchId(policy: PolicyDecl, branch: PolicyDecl["branches"][number]): string {
  return `policyBranch:${String(branch.stableId?.value ?? `${policy.name}.${branch.name}`)}`;
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
  const projections: IRProjection[] = [...symbols.projections.values()].map((projection) => lowerProjection(projection, symbols, file));
  validateProjectionGraph(symbols, file);
  const events: IREvent[] = [...symbols.events.values()].map((event) => {
    const payload = symbols.entities.get(event.payloadType.name);
    if (!payload || event.payloadType.collection || event.payloadType.moneyCurrency) {
      throw new ModelError("E3101", `Event '${event.name}' payload type '${event.payloadType.name}' must be an entity.`, event.payloadType.span, file);
    }
    if (event.retry && event.importedFrom) {
      throw new ModelError("E3502", `Imported event '${event.name}' cannot declare local publication retry policy.`, event.retry.span, file);
    }
    if (event.retry && (!Number.isInteger(event.retry.maxAttempts) || event.retry.maxAttempts < 1 || event.retry.maxAttempts > 1000)) {
      throw new ModelError("E3402", "Event publication retry maxAttempts must be an integer from 1 through 1000.", event.retry.span, file);
    }
    if (event.recovery && event.importedFrom) {
      throw new ModelError("E3504", `Imported event '${event.name}' cannot declare local publication recovery policy.`, event.recovery.span, file);
    }
    if (event.recovery && !event.retry) {
      throw new ModelError("E3503", "Manual event publication recovery requires a bounded retry maxAttempts policy.", event.recovery.span, file);
    }
    return {
      id: eventId(event),
      name: event.name,
      identity: identity(event.stableId),
      payloadEntityId: entityId(payload),
      source: event.importedFrom
        ? { kind: "imported" as const, ...event.importedFrom }
        : { kind: "local" as const },
      publicationFailurePolicy: event.retry
        ? { mode: "deadLetterAfterMaxAttempts" as const, maxAttempts: event.retry.maxAttempts, recovery: event.recovery?.mode ?? "none" as const }
        : { mode: "unboundedRetry" as const },
      span: irSpan(event.span, file),
      naming: { typescriptName: event.name },
    };
  });
  const policies = [...symbols.policies.values()].map((policy) => lowerPolicy(policy, symbols, file));
  const actions: IRAction[] = [...symbols.actions.values()].map((action) => lowerAction(action, symbols, principalName, file));
  const consumers: IRConsumer[] = [...symbols.consumers.values()].map((consumer) => lowerConsumer(consumer, symbols, file));
  validateConsumerEventGraph(consumers, symbols, file);
  const queries: IRQuery[] = [...symbols.queries.values()].map((query) => lowerQuery(query, symbols, principalName, file));
  const workflows = lowerWorkflows(symbols, entities, enums, actions, file);
  const enforcement = buildEnforcement(enums, entities, projections, events, policies, actions, consumers, queries, workflows, schema, internalSchema);
  return {
    irVersion: 21,
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
    projections,
    events,
    policies,
    actions,
    consumers,
    queries,
    workflows,
    enforcement,
  };
}

function collectSymbols(program: Program, file: string): Symbols {
  const enums = new Map<string, Extract<Declaration, { kind: "enum" }>>();
  const entities = new Map<string, EntityDecl>();
  const projections = new Map<string, ProjectionDecl>();
  const events = new Map<string, EventDecl>();
  const policies = new Map<string, PolicyDecl>();
  const actions = new Map<string, ActionDecl>();
  const consumers = new Map<string, ConsumerDecl>();
  const queries = new Map<string, QueryDecl>();
  const workflows = new Map<string, WorkflowDecl>();
  const top = new Map<string, Declaration>();
  for (const declaration of program.declarations) {
    const previous = top.get(declaration.name);
    if (previous) throw new ModelError("E2001", `Duplicate declaration '${declaration.name}'.`, declaration.span, file, { message: "First declared here.", span: previous.span });
    top.set(declaration.name, declaration);
    if (declaration.kind === "enum") enums.set(declaration.name, declaration);
    if (declaration.kind === "entity") entities.set(declaration.name, declaration);
    if (declaration.kind === "projection") projections.set(declaration.name, declaration);
    if (declaration.kind === "event") events.set(declaration.name, declaration);
    if (declaration.kind === "policy") policies.set(declaration.name, declaration);
    if (declaration.kind === "action") actions.set(declaration.name, declaration);
    if (declaration.kind === "consumer") consumers.set(declaration.name, declaration);
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
  return { enums, entities, projections, events, policies, actions, consumers, queries, workflows, fields, loweredPolicies: new Map(), policyStack: [] };
}

type StableDeclarationKind = "ent" | "fld" | "prj" | "pfd" | "enm" | "emv" | "evt" | "pol" | "pbr" | "act" | "con" | "qry" | "inv" | "exc" | "wfl" | "trn";

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
  for (const consumer of symbols.consumers.values()) {
    if (consumer.stableId) validateStableId(consumer.stableId, "con", stableIds, file);
  }
  for (const event of symbols.events.values()) {
    if (event.stableId) validateStableId(event.stableId, "evt", stableIds, file);
    if (event.importedFrom) {
      if (!/^model:[A-Za-z][A-Za-z0-9_.-]*$/.test(event.importedFrom.modelId)) {
        throw new ModelError("E3105", `Imported event '${event.name}' has invalid model ID '${event.importedFrom.modelId}'.`, event.span, file);
      }
      if (!event.importedFrom.modelVersion.length || !/^sha256:[0-9a-f]{64}$/.test(event.importedFrom.sourceHash)) {
        throw new ModelError("E3106", `Imported event '${event.name}' requires a non-empty version and canonical SHA-256 source hash.`, event.span, file);
      }
    }
  }
  for (const policy of symbols.policies.values()) {
    if (policy.stableId) validateStableId(policy.stableId, "pol", stableIds, file);
    const parameterNames = new Set<string>();
    for (const parameter of policy.parameters) {
      if (parameterNames.has(parameter.name)) throw new ModelError("E2424", `Duplicate policy parameter '${policy.name}.${parameter.name}'.`, parameter.span, file);
      parameterNames.add(parameter.name);
    }
    const branchNames = new Set<string>();
    for (const branch of policy.branches) {
      if (branchNames.has(branch.name)) throw new ModelError("E2425", `Duplicate policy branch '${policy.name}.${branch.name}'.`, branch.span, file);
      branchNames.add(branch.name);
      if (branch.stableId) validateStableId(branch.stableId, "pbr", stableIds, file);
    }
  }
  for (const query of symbols.queries.values()) {
    if (query.stableId) validateStableId(query.stableId, "qry", stableIds, file);
  }
  for (const projection of symbols.projections.values()) {
    if (projection.stableId) validateStableId(projection.stableId, "prj", stableIds, file);
    for (const field of projection.fields) {
      if (field.stableId) validateStableId(field.stableId, "pfd", stableIds, file);
    }
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
      prj: "projection",
      pfd: "projection field",
      enm: "enum",
      emv: "enum member",
      evt: "event",
      pol: "policy",
      pbr: "policy branch",
      act: "action",
      con: "consumer",
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

function lowerPolicy(policy: PolicyDecl, symbols: Symbols, file: string): IRPolicy {
  const id = policyId(policy);
  const cached = symbols.loweredPolicies.get(id);
  if (cached) return cached;
  if (symbols.policyStack.includes(id)) {
    const cycle = [...symbols.policyStack.slice(symbols.policyStack.indexOf(id)), id].join(" -> ");
    throw new ModelError("E2420", `Policy recursion is not allowed (${cycle}).`, policy.span, file);
  }
  symbols.policyStack.push(id);
  try {
    const parameters: IRParameter[] = policy.parameters.map((parameter) => {
      if (parameter.type.collection === "set") throw new ModelError("E2421", "Set-valued policy parameters are not supported in policy v1.", parameter.type.span, file);
      if (!parameter.type.moneyCurrency && !scalars.has(parameter.type.name)
        && !symbols.enums.has(parameter.type.name) && !symbols.entities.has(parameter.type.name)) {
        throw new ModelError("E2005", `Unknown type '${parameter.type.name}'.`, parameter.type.span, file);
      }
      return {
        id: `parameter:${id}.${parameter.name}`,
        name: parameter.name,
        type: resolvedType(parameter.type, symbols),
        caller: false,
        span: irSpan(parameter.span, file),
        naming: { sqlParameter: `p_${snakeCase(parameter.name)}`, typescriptProperty: parameter.name },
      };
    });
    const scope: Scope = { kind: "policy", policy, parameters: new Map(parameters.map((parameter) => [parameter.name, parameter])) };
    const branches = policy.branches.map((branch) => {
      const expression = typeExpression(branch.expression, scope, symbols, file);
      requireBoolean(expression, branch.expression.span, file, `Policy branch '${policy.name}.${branch.name}'`);
      return {
        id: policyBranchId(policy, branch),
        name: branch.name,
        identity: identity(branch.stableId),
        expression,
        sourceExpression: expressionText(branch.expression),
        span: irSpan(branch.span, file),
      };
    });
    const result: IRPolicy = {
      id,
      name: policy.name,
      identity: identity(policy.stableId),
      parameters,
      branches,
      span: irSpan(policy.span, file),
    };
    symbols.loweredPolicies.set(id, result);
    return result;
  } finally {
    symbols.policyStack.pop();
  }
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
  validateAuthorizationPolicyUse(authorization, action.authorize.span, file);
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
  const emitted = new Set<string>();
  const emittedEventIds = action.emits.map((emission) => {
    const event = symbols.events.get(emission.eventName);
    if (!event) throw new ModelError("E3102", `Action '${action.name}' emits unknown event '${emission.eventName}'.`, emission.span, file);
    if (event.importedFrom) throw new ModelError("E3107", `Action '${action.name}' cannot emit imported event contract '${event.name}'.`, emission.span, file);
    const payload = symbols.entities.get(event.payloadType.name);
    if (!payload || entityId(payload) !== entityId(effectEntity)) {
      throw new ModelError("E3103", `Event '${event.name}' payload must match action '${action.name}' return entity '${returnEntity.name}'.`, emission.span, file);
    }
    const id = eventId(event);
    if (emitted.has(id)) throw new ModelError("E3104", `Action '${action.name}' may emit event '${event.name}' at most once.`, emission.span, file);
    emitted.add(id);
    return id;
  });
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
    ...(action.idempotency ? {
      idempotency: {
        mode: action.idempotency.mode,
        scope: "authenticatedPrincipal" as const,
        replay: "storedResult" as const,
        fingerprint: "canonicalSha256" as const,
      },
    } : {}),
    effect: { kind: action.effect.kind, target: action.effect.target, entityId: entityId(effectEntity), assignments },
    emittedEventIds,
    lockPlan,
    span: irSpan(action.span, file),
    naming: { sqlFunction: snakeCase(action.name), typescriptMethod: action.name },
  };
}

function lowerConsumer(consumer: ConsumerDecl, symbols: Symbols, file: string): IRConsumer {
  const semanticId = consumerId(consumer);
  const event = symbols.events.get(consumer.eventName);
  if (!event) throw new ModelError("E3201", `Consumer '${consumer.name}' references unknown event '${consumer.eventName}'.`, consumer.eventSpan, file);
  const payloadEntity = symbols.entities.get(event.payloadType.name)!;
  if (consumer.payloadParameter.type.collection || consumer.payloadParameter.type.moneyCurrency
    || consumer.payloadParameter.type.name !== payloadEntity.name) {
    throw new ModelError("E3202", `Consumer '${consumer.name}' payload parameter must use event '${event.name}' payload entity '${payloadEntity.name}'.`, consumer.payloadParameter.span, file);
  }
  const payloadParameter: IRParameter = {
    id: `parameter:${semanticId}.${consumer.payloadParameter.name}`,
    name: consumer.payloadParameter.name,
    type: entityId(payloadEntity),
    caller: false,
    span: irSpan(consumer.payloadParameter.span, file),
    naming: { sqlParameter: "p_envelope", typescriptProperty: consumer.payloadParameter.name },
  };
  const scope: Scope = {
    kind: "consumer",
    consumer,
    parameters: new Map([[payloadParameter.name, payloadParameter]]),
  };
  const authorizationExpression = typeExpression(consumer.authorize, scope, symbols, file);
  requireBoolean(authorizationExpression, consumer.authorize.span, file, "Consumer authorization");
  validateAuthorizationPolicyUse(authorizationExpression, consumer.authorize.span, file);
  const preconditionNames = new Set<string>();
  const preconditions = consumer.requires.map((requirement) => {
    if (preconditionNames.has(requirement.name)) throw new ModelError("E3203", `Duplicate consumer precondition '${requirement.name}'.`, requirement.span, file);
    preconditionNames.add(requirement.name);
    const expression = typeExpression(requirement.expression, scope, symbols, file);
    requireBoolean(expression, requirement.expression.span, file, "Consumer precondition");
    return {
      id: `require:${semanticId}.${requirement.name}`,
      name: requirement.name,
      expression,
      sourceExpression: expressionText(requirement.expression),
      span: irSpan(requirement.span, file),
    };
  });
  const returnEntity = symbols.entities.get(consumer.returnType.name);
  if (!returnEntity || consumer.returnType.collection || consumer.returnType.moneyCurrency) {
    throw new ModelError("E3204", `Consumer return type '${consumer.returnType.name}' must be an entity.`, consumer.returnType.span, file);
  }
  let effectEntity: EntityDecl;
  if (consumer.effect.kind === "create") {
    const entity = symbols.entities.get(consumer.effect.target);
    if (!entity) throw new ModelError("E3205", `Unknown consumer create target entity '${consumer.effect.target}'.`, consumer.effect.span, file);
    effectEntity = entity;
  } else {
    if (consumer.effect.target !== payloadParameter.name) {
      throw new ModelError("E3206", `Consumer update target '${consumer.effect.target}' must be its payload parameter '${payloadParameter.name}'.`, consumer.effect.span, file);
    }
    effectEntity = payloadEntity;
  }
  if (returnEntity.name !== effectEntity.name) {
    throw new ModelError("E3207", "Consumer return type must match the created or updated entity.", consumer.returnType.span, file);
  }
  const effectFields = symbols.fields.get(effectEntity.name)!;
  const assigned = new Set<string>();
  const assignments = consumer.effect.assignments.map((assignment) => {
    if (assigned.has(assignment.field)) throw new ModelError("E3208", `Field '${assignment.field}' is assigned more than once.`, assignment.span, file);
    assigned.add(assignment.field);
    const field = effectFields.get(assignment.field);
    if (!field) throw new ModelError("E2313", `Unknown field '${effectEntity.name}.${assignment.field}'.`, assignment.span, file);
    if (field.annotations.some((annotation) => annotation.name === "generated")) {
      throw new ModelError("E2316", `Consumer effects may not assign database-generated field '${effectEntity.name}.${field.name}'.`, assignment.span, file);
    }
    if (consumer.effect.kind === "update" && field.annotations.some((annotation) => annotation.name === "immutable" || annotation.name === "id")) {
      throw new ModelError("E2317", `A consumer update may not change immutable field '${effectEntity.name}.${field.name}'.`, assignment.span, file);
    }
    for (const workflow of symbols.workflows.values()) {
      if (consumer.effect.kind === "update" && workflow.entityName === effectEntity.name && workflow.fieldName === field.name) {
        throw new ModelError("E3209", `Consumer '${consumer.name}' cannot update workflow field '${effectEntity.name}.${field.name}'.`, assignment.span, file);
      }
    }
    const expression = typeExpression(assignment.expression, scope, symbols, file);
    ensureAssignable(field, expression, symbols, assignment.expression.span, file);
    if (field.annotations.some((annotation) => annotation.name === "snapshot")
      && expression.kind !== "nullLiteral" && expression.kind !== "fieldAccess") {
      throw new ModelError("E2415", `@snapshot field '${field.name}' must be assigned null or a direct field value.`, assignment.expression.span, file);
    }
    return { fieldId: fieldId(effectEntity, field), fieldName: field.name, expression };
  });
  if (consumer.effect.kind === "create") {
    for (const field of effectFields.values()) {
      if (!field.optional && !field.default
        && !field.annotations.some((annotation) => annotation.name === "generated")
        && !assigned.has(field.name)) {
        throw new ModelError("E2315", `Consumer create effect must assign required field '${effectEntity.name}.${field.name}'.`, consumer.effect.span, file);
      }
    }
  }
  const emitted = new Set<string>();
  const emittedEventIds = consumer.emits.map((emission) => {
    const emittedEvent = symbols.events.get(emission.eventName);
    if (!emittedEvent) throw new ModelError("E3301", `Consumer '${consumer.name}' emits unknown event '${emission.eventName}'.`, emission.span, file);
    if (emittedEvent.importedFrom) throw new ModelError("E3302", `Consumer '${consumer.name}' cannot emit imported event contract '${emittedEvent.name}'.`, emission.span, file);
    const emittedPayload = symbols.entities.get(emittedEvent.payloadType.name);
    if (!emittedPayload || entityId(emittedPayload) !== entityId(effectEntity)) {
      throw new ModelError("E3303", `Event '${emittedEvent.name}' payload must match consumer '${consumer.name}' return entity '${returnEntity.name}'.`, emission.span, file);
    }
    const id = eventId(emittedEvent);
    if (emitted.has(id)) throw new ModelError("E3304", `Consumer '${consumer.name}' may emit event '${emittedEvent.name}' at most once.`, emission.span, file);
    emitted.add(id);
    return id;
  });
  return {
    id: semanticId,
    name: consumer.name,
    identity: identity(consumer.stableId),
    sourceEventId: eventId(event),
    payloadParameter,
    acceptedPayloadEntityId: entityId(payloadEntity),
    returnEntityId: entityId(returnEntity),
    authorization: {
      id: `authorize:${semanticId}`,
      name: "authorize",
      expression: authorizationExpression,
      sourceExpression: expressionText(consumer.authorize),
      span: irSpan(consumer.authorize.span, file),
    },
    preconditions,
    failurePolicy: consumer.retry
      ? (() => {
          if (!Number.isInteger(consumer.retry.maxAttempts) || consumer.retry.maxAttempts < 1 || consumer.retry.maxAttempts > 1000) {
            throw new ModelError("E3401", "Consumer retry maxAttempts must be an integer from 1 through 1000.", consumer.retry.span, file);
          }
          return {
            mode: "deadLetterAfterMaxAttempts" as const,
            maxAttempts: consumer.retry.maxAttempts,
            recovery: consumer.recovery?.mode ?? "none" as const,
          };
        })()
      : (() => {
          if (consumer.recovery) {
            throw new ModelError("E3501", "Manual consumer recovery requires a bounded retry maxAttempts policy.", consumer.recovery.span, file);
          }
          return { mode: "unboundedRetry" as const };
        })(),
    effect: { kind: consumer.effect.kind, target: consumer.effect.target, entityId: entityId(effectEntity), assignments },
    emittedEventIds,
    lockPlan: consumer.effect.kind === "update"
      ? [{ id: `lock:${semanticId}.${payloadParameter.name}`, source: payloadParameter.id, parameterId: payloadParameter.id, entityId: entityId(effectEntity), mode: "update", order: 0 }]
      : [],
    delivery: {
      transport: "atLeastOnce",
      deduplication: "transactionalInbox",
      duplicateResult: "storedResult",
      identity: "consumerAndSourceEvent",
    },
    span: irSpan(consumer.span, file),
    naming: { sqlFunction: `consume_${snakeCase(consumer.name)}`, typescriptMethod: consumer.name },
  };
}

function validateConsumerEventGraph(consumers: IRConsumer[], symbols: Symbols, file: string): void {
  const edges = new Map<string, { eventId: string; consumer: IRConsumer }[]>();
  for (const consumer of consumers) {
    const outgoing = edges.get(consumer.sourceEventId) ?? [];
    for (const eventId of consumer.emittedEventIds) outgoing.push({ eventId, consumer });
    edges.set(consumer.sourceEventId, outgoing);
  }
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (currentEventId: string, path: string[]): void => {
    if (complete.has(currentEventId)) return;
    active.add(currentEventId);
    for (const edge of edges.get(currentEventId) ?? []) {
      if (active.has(edge.eventId)) {
        const cycle = [...path, edge.eventId]
          .map((id) => [...symbols.events.values()].find((event) => eventId(event) === id)?.name ?? id)
          .join(" -> ");
        const declaration = symbols.consumers.get(edge.consumer.name)!;
        throw new ModelError("E3305", `Consumer event emissions must be acyclic; detected ${cycle}.`, declaration.span, file);
      }
      visit(edge.eventId, [...path, edge.eventId]);
    }
    active.delete(currentEventId);
    complete.add(currentEventId);
  };
  for (const event of symbols.events.values()) visit(eventId(event), [event.name]);
}

function lowerProjection(projection: ProjectionDecl, symbols: Symbols, file: string): IRProjection {
  const sourceEntity = symbols.entities.get(projection.sourceType.name);
  if (projection.sourceType.collection || projection.sourceType.moneyCurrency || !sourceEntity) {
    throw new ModelError("E2621", `Projection source '${projection.sourceType.name}' must be an entity.`, projection.sourceType.span, file);
  }
  if (projection.fields.length === 0) {
    throw new ModelError("E2622", `Projection '${projection.name}' must select at least one field.`, projection.span, file);
  }
  const sourceFields = symbols.fields.get(sourceEntity.name)!;
  const seen = new Map<string, Span>();
  const fields = projection.fields.map((selected) => {
    const previous = seen.get(selected.name);
    if (previous) {
      throw new ModelError("E2623", `Duplicate projection field '${projection.name}.${selected.name}'.`, selected.span, file, {
        message: "First selected here.",
        span: previous,
      });
    }
    seen.set(selected.name, selected.span);
    const sourceField = sourceFields.get(selected.name);
    if (!sourceField) {
      throw new ModelError("E2624", `Unknown projection source field '${sourceEntity.name}.${selected.name}'.`, selected.nameSpan, file);
    }
    if (sourceField.type.collection) {
      throw new ModelError("E2625", `Projection field '${sourceEntity.name}.${sourceField.name}' cannot select a collection-valued field.`, selected.span, file);
    }
    let nestedProjectionId: string | undefined;
    if (selected.nestedProjectionType) {
      const nestedType = selected.nestedProjectionType;
      const nestedProjection = !nestedType.collection && !nestedType.moneyCurrency
        ? symbols.projections.get(nestedType.name)
        : undefined;
      if (!nestedProjection) {
        throw new ModelError("E2627", `Nested projection target '${nestedType.name}' must be a projection.`, nestedType.span, file);
      }
      const referencedEntity = !sourceField.type.collection && !sourceField.type.moneyCurrency
        ? symbols.entities.get(sourceField.type.name)
        : undefined;
      if (!referencedEntity) {
        throw new ModelError("E2628", `Projection field '${sourceEntity.name}.${sourceField.name}' must be an entity reference to use nested projection '${nestedProjection.name}'.`, selected.span, file);
      }
      const nestedSource = !nestedProjection.sourceType.collection && !nestedProjection.sourceType.moneyCurrency
        ? symbols.entities.get(nestedProjection.sourceType.name)
        : undefined;
      if (!nestedSource || entityId(nestedSource) !== entityId(referencedEntity)) {
        throw new ModelError(
          "E2629",
          `Nested projection '${nestedProjection.name}' source '${nestedProjection.sourceType.name}' must match referenced entity '${referencedEntity.name}'.`,
          nestedType.span,
          file,
        );
      }
      nestedProjectionId = projectionId(nestedProjection);
    }
    return {
      id: projectionFieldId(projection, selected),
      name: selected.name,
      identity: identity(selected.stableId),
      sourceFieldId: fieldId(sourceEntity, sourceField),
      ...(nestedProjectionId ? { nestedProjectionId } : {}),
      span: irSpan(selected.span, file),
    };
  });
  return {
    id: projectionId(projection),
    name: projection.name,
    identity: identity(projection.stableId),
    sourceEntityId: entityId(sourceEntity),
    fields,
    span: irSpan(projection.span, file),
    naming: { typescriptName: projection.name },
  };
}

function validateProjectionGraph(symbols: Symbols, file: string): void {
  const active = new Set<string>();
  const complete = new Set<string>();

  const visit = (projection: ProjectionDecl, path: string[]): void => {
    if (complete.has(projection.name)) return;
    active.add(projection.name);
    for (const field of projection.fields) {
      const nestedName = field.nestedProjectionType?.name;
      if (!nestedName) continue;
      const nested = symbols.projections.get(nestedName);
      if (!nested) continue;
      if (active.has(nested.name)) {
        const start = path.indexOf(nested.name);
        const cycle = [...path.slice(start), nested.name].join(" -> ");
        throw new ModelError("E2630", `Projection traversal dependencies must be acyclic; detected ${cycle}.`, field.span, file);
      }
      visit(nested, [...path, nested.name]);
    }
    active.delete(projection.name);
    complete.add(projection.name);
  };

  for (const projection of symbols.projections.values()) visit(projection, [projection.name]);
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
  if (query.pagination && seen.has("cursor")) {
    throw new ModelError("E2611", "Paginated queries reserve the generated input name 'cursor'.", seen.get("cursor")!, file);
  }
  const sourceEntity = symbols.entities.get(query.sourceType.name);
  if (!sourceEntity) {
    throw new ModelError("E2601", `Query source '${query.sourceType.name}' must be an entity.`, query.sourceType.span, file);
  }
  const projection = symbols.projections.get(query.returnType.name);
  if (query.returnType.collection || query.returnType.moneyCurrency || !projection) {
    throw new ModelError("E2620", `Query return type '${query.returnType.name}' must be a projection.`, query.returnType.span, file);
  }
  const projectionSource = symbols.entities.get(projection.sourceType.name);
  if (!projectionSource || entityId(projectionSource) !== entityId(sourceEntity)) {
    throw new ModelError(
      "E2626",
      `Query '${query.name}' source '${sourceEntity.name}' must match projection '${projection.name}' source '${projection.sourceType.name}'.`,
      query.returnType.span,
      file,
    );
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

  const paginationRevision = query.pagination
    ? `sha256:${createHash("sha256").update(JSON.stringify({
        id: semanticId,
        parameters: parameters.filter((parameter) => !parameter.caller).map((parameter) => ({ id: parameter.id, type: parameter.type })),
        sourceEntityId: entityId(sourceEntity),
        returnProjectionId: projectionId(projection),
        authorization,
        rowPolicy,
        orderBy: { fieldId: fieldId(sourceEntity, orderField), direction: query.orderBy.direction },
        limit: query.limit,
        pagination: "cursor-v1",
      })).digest("hex")}`
    : undefined;

  return {
    id: semanticId,
    name: query.name,
    identity: identity(query.stableId),
    parameters,
    callerParameterId: caller.id,
    callableParameters: parameters.filter((parameter) => !parameter.caller).map((parameter) => parameter.id),
    sourceEntityId: entityId(sourceEntity),
    returnProjectionId: projectionId(projection),
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
    ...(paginationRevision ? { pagination: { kind: "cursor" as const, cursorVersion: 1 as const, revision: paginationRevision } } : {}),
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
  if (expression.kind === "call") {
    const declaration = symbols.policies.get(expression.name);
    if (!declaration) throw new ModelError("E2416", `Unknown policy '${expression.name}'.`, expression.span, file);
    const policy = lowerPolicy(declaration, symbols, file);
    if (expression.arguments.length !== policy.parameters.length) {
      throw new ModelError("E2417", `Policy '${policy.name}' expects ${policy.parameters.length} arguments, received ${expression.arguments.length}.`, expression.span, file);
    }
    const args = expression.arguments.map((argument, index) => {
      const typed = typeExpression(argument, scope, symbols, file);
      const parameter = policy.parameters[index]!;
      if (!compatibleTypes(parameter.type, typed.type) || typed.nullable) {
        throw new ModelError("E2418", `Policy argument '${parameter.name}' requires non-null ${parameter.type}, not ${typed.nullable ? "nullable " : ""}${typed.type}.`, argument.span, file);
      }
      return typed;
    });
    return { kind: "policyCall", policyId: policy.id, arguments: args, type: "Boolean", nullable: false };
  }
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

function containsPolicyCall(expression: IRExpression): boolean {
  if (expression.kind === "policyCall") return true;
  if (expression.kind === "unary") return containsPolicyCall(expression.operand);
  if (expression.kind === "binary") return containsPolicyCall(expression.left) || containsPolicyCall(expression.right);
  if (expression.kind === "nullComparison") return containsPolicyCall(expression.operand);
  return false;
}

function validateAuthorizationPolicyUse(expression: IRExpression, span: Span, file: string): void {
  let calls = 0;
  const visit = (node: IRExpression, conjunctive: boolean): void => {
    if (node.kind === "policyCall") {
      calls += 1;
      if (!conjunctive) throw new ModelError("E2422", "An authorization policy call must occur positively in a conjunction, not under 'or' or 'not'.", span, file);
      return;
    }
    if (node.kind === "unary") {
      if (containsPolicyCall(node.operand)) visit(node.operand, false);
      return;
    }
    if (node.kind === "binary") {
      const next = conjunctive && node.operator === "and";
      visit(node.left, next);
      visit(node.right, next);
    }
  };
  if (expression.kind === "policyCall") visit(expression, true);
  else if (expression.kind === "binary" && expression.operator === "and") visit(expression, true);
  else visit(expression, false);
  if (calls > 1) throw new ModelError("E2423", "An action authorization may invoke at most one top-level policy so executed authority is exact.", span, file);
}

function collectEntityParameters(expression: IRExpression, found: Set<string>): void {
  if (expression.kind === "entityValue") found.add(expression.parameterId);
  if (expression.kind === "fieldAccess" && expression.source.startsWith("parameter:")) found.add(expression.source);
  if (expression.kind === "unary") collectEntityParameters(expression.operand, found);
  if (expression.kind === "binary") {
    collectEntityParameters(expression.left, found);
    collectEntityParameters(expression.right, found);
  }
  if (expression.kind === "policyCall") {
    for (const argument of expression.arguments) collectEntityParameters(argument, found);
  }
  if (expression.kind === "nullComparison") collectEntityParameters(expression.operand, found);
}

function buildEnforcement(
  enums: IREnum[],
  entities: IREntity[],
  projections: IRProjection[],
  events: IREvent[],
  policies: IRPolicy[],
  actions: IRAction[],
  consumers: IRConsumer[],
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
    id: "boundary:consumer_role",
    purpose: "Confine event consumption to a dedicated non-login role with execute-only handler access.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_consumer NOLOGIN",
  }, {
    id: "boundary:recovery_role",
    purpose: "Confine opted-in terminal consumer recovery to a dedicated non-login role with execute-only access.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_recovery NOLOGIN",
  }, {
    id: "boundary:publication_recovery_role",
    purpose: "Confine opted-in terminal publication recovery to a separate non-login role with execute-only access.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_publication_recovery NOLOGIN",
  }, {
    id: "boundary:failure_observer_role",
    purpose: "Confine bounded terminal-failure inspection to a separate non-login role with execute-only access and no recovery authority.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_failure_observer NOLOGIN",
  }, {
    id: "boundary:failure_acknowledger_role",
    purpose: "Confine audited terminal-cycle acknowledgement to a separate non-login role with execute-only access and no observation or recovery authority.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_failure_acknowledger NOLOGIN",
  }, {
    id: "boundary:failure_claimant_role",
    purpose: "Confine first-writer terminal-cycle self-claiming to a separate non-login role with execute-only access and no observation, acknowledgement, or recovery authority.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_failure_claimant NOLOGIN",
  }, {
    id: "boundary:dispatcher_role",
    purpose: "Confine event delivery leasing, acknowledgement, release, and failure recording to a dedicated non-login dispatcher role.",
    layer: "PostgreSQL role",
    artifact: "postgres/001_roles.sql",
    objectName: "modellang_dispatcher NOLOGIN",
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
  for (const policy of policies) {
    entries.push({
      id: policy.id,
      purpose: `Evaluate reusable policy ${policy.name} as a closed Boolean decision with exactly one successful authority branch.`,
      layer: "Canonical decision plan",
      artifact: "decisions.json",
      objectName: policy.id,
      source: policy.span,
    });
    for (const branch of policy.branches) entries.push({
      id: branch.id,
      purpose: branch.sourceExpression,
      layer: "PostgreSQL policy branch",
      artifact: "postgres/003_actions.sql",
      objectName: policy.id,
      source: branch.span,
    });
  }
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
  for (const event of events.filter((candidate) => candidate.source.kind === "local")) entries.push({
    id: `publication-failure-policy:${event.id}`,
    purpose: event.publicationFailurePolicy.mode === "deadLetterAfterMaxAttempts"
      ? `Record lease-bound publication failures durably, stop claiming after ${event.publicationFailurePolicy.maxAttempts} failures, and ${event.publicationFailurePolicy.recovery === "manual" ? "permit isolated audited manual recovery" : "deny generated recovery"}.`
      : "Record lease-bound publication failures durably while preserving unbounded retry.",
    layer: "PostgreSQL event outbox publication state",
    artifact: "postgres/002_schema.sql",
    objectName: `${internalSchema}.event_outbox`,
    source: event.span,
  });
  for (const action of actions) {
    const fn = `${schema}.${action.naming.sqlFunction}`;
    const caller = action.parameters.find((parameter) => parameter.id === action.callerParameterId)!;
    entries.push({ id: `caller:${action.id}.${caller.name}`, purpose: "Resolve the semantic caller from direct session identity or transaction-bound gateway claims; no caller UUID is accepted.", layer: "PostgreSQL authenticated identity", artifact: "postgres/003_actions.sql", objectName: fn, source: caller.span });
    for (const parameter of action.parameters.filter((candidate) => isMoneyType(candidate.type))) {
      entries.push({ id: `money-parameter:${parameter.id}`, purpose: `Validate ${parameter.name} against its exact currency, precision, and scale contract.`, layer: "PostgreSQL action input validation", artifact: "postgres/003_actions.sql", objectName: fn, source: parameter.span });
    }
    entries.push({ id: `boundary:${action.id}.safe_search_path`, purpose: "Prevent caller-controlled object shadowing inside the privileged function.", layer: "PostgreSQL function configuration", artifact: "postgres/003_actions.sql", objectName: `${fn} search_path=pg_catalog,pg_temp` });
    entries.push({ id: `boundary:${action.id}.applicability`, purpose: "Evaluate authenticated current-state applicability without mutation or authority grant from the same decision plan used by execution.", layer: "PostgreSQL stable function", artifact: "postgres/003_decisions.sql", objectName: `${schema}.${decisionFunctionName(action.id)}`, source: action.span });
    if (action.idempotency) entries.push({ id: `idempotency:${action.id}`, purpose: "Serialize principal-scoped retries and replay the one committed result from a private transactional receipt.", layer: "PostgreSQL command receipt", artifact: "postgres/003_actions.sql", objectName: `${internalSchema}.command_receipt`, source: action.span });
    entries.push({ id: decisionRevisionRuleId(action.id), purpose: "Compare an explicitly supplied opaque revision only after current authorization; a match grants no authority.", layer: "PostgreSQL action and applicability functions", artifact: "postgres/003_actions.sql", objectName: fn, source: action.span });
    entries.push({ id: action.authorization.id, purpose: action.authorization.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: action.authorization.span });
    for (const precondition of action.preconditions) entries.push({ id: precondition.id, purpose: precondition.sourceExpression, layer: "PostgreSQL action guard", artifact: "postgres/003_actions.sql", objectName: fn, source: precondition.span });
    entries.push({ id: `effect:${action.id}`, purpose: `${action.effect.kind} ${action.effect.entityId}.`, layer: "PostgreSQL action function", artifact: "postgres/003_actions.sql", objectName: fn, source: action.span });
    for (const eventId of action.emittedEventIds) {
      const event = events.find((candidate) => candidate.id === eventId)!;
      entries.push({ id: `emit:${action.id}.${event.id}`, purpose: `Append ${event.name} with the committed post-effect entity payload.`, layer: "PostgreSQL transactional outbox", artifact: "postgres/003_actions.sql", objectName: `${internalSchema}.event_outbox`, source: action.span });
    }
    for (const lock of action.lockPlan) entries.push({ id: lock.id, purpose: `Stabilize ${lock.source} before evaluating guards and effects.`, layer: "PostgreSQL row lock", artifact: "postgres/003_actions.sql", objectName: `${lock.mode === "update" ? "FOR UPDATE" : "FOR SHARE"} in ${fn}` });
  }
  for (const consumer of consumers) {
    entries.push({
      id: consumer.id,
      purpose: `Consume ${consumer.sourceEventId} with transactional inbox deduplication, one local committed effect, and atomic downstream event emission.`,
      layer: "PostgreSQL consumer function",
      artifact: "postgres/003_consumers.sql",
      objectName: `${internalSchema}.${consumer.naming.sqlFunction}`,
      source: consumer.span,
    });
    entries.push({
      id: `inbox:${consumer.id}`,
      purpose: "Deduplicate one source event per stable consumer identity and replay the committed stored result.",
      layer: "PostgreSQL transactional inbox",
      artifact: "postgres/002_schema.sql",
      objectName: `${internalSchema}.event_inbox`,
      source: consumer.span,
    });
    entries.push({
      id: `failure-policy:${consumer.id}`,
      purpose: consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts"
        ? `Record failed deliveries durably and return terminal deadLetter after ${consumer.failurePolicy.maxAttempts} attempts.`
        : "Record failed deliveries durably while preserving unbounded retry disposition.",
      layer: "PostgreSQL consumer failure state",
      artifact: "postgres/002_schema.sql",
      objectName: `${internalSchema}.consumer_failure`,
      source: consumer.span,
    });
    if (consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts" && consumer.failurePolicy.recovery === "manual") entries.push({
      id: `recovery-policy:${consumer.id}`,
      purpose: "Permit only isolated, audited manual reopening of durable terminal failure without invoking the handler or mutating broker state.",
      layer: "PostgreSQL consumer recovery",
      artifact: "postgres/002_schema.sql",
      objectName: `${internalSchema}.consumer_recovery_audit`,
      source: consumer.span,
    });
    for (const eventId of consumer.emittedEventIds) {
      const event = events.find((candidate) => candidate.id === eventId)!;
      entries.push({
        id: `emit:${consumer.id}.${event.id}`,
        purpose: `Append ${event.name} with the committed post-effect entity payload, inherited correlation, and source-event causation.`,
        layer: "PostgreSQL transactional outbox",
        artifact: "postgres/003_consumers.sql",
        objectName: `${internalSchema}.event_outbox`,
        source: consumer.span,
      });
    }
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
    if (query.pagination) entries.push({
      id: `cursor:${query.id}`,
      purpose: "Continue by the declared order and identity key; bind the opaque cursor to model/query identity, source, caller, filters, and ordering, and re-evaluate authorization and row policy.",
      layer: "PostgreSQL keyset pagination",
      artifact: "postgres/003_queries.sql",
      objectName: fn,
      source: query.span,
    });
    const closure: IRProjection[] = [];
    const visited = new Set<string>();
    const visit = (projectionId: string): void => {
      if (visited.has(projectionId)) return;
      const projection = projections.find((candidate) => candidate.id === projectionId);
      if (!projection) return;
      visited.add(projectionId);
      closure.push(projection);
      for (const field of projection.fields) if (field.nestedProjectionId) visit(field.nestedProjectionId);
    };
    visit(query.returnProjectionId);
    const relatedEntityIds = [...new Set(closure.slice(1).map((projection) => projection.sourceEntityId))];
    entries.push({
      id: `read:${query.id}`,
      purpose: relatedEntityIds.length === 0
        ? `Read ${query.sourceEntityId} through the generated query boundary.`
        : `Read ${query.sourceEntityId} root rows and authored to-one related entities ${relatedEntityIds.join(", ")} through the generated query boundary.`,
      layer: "PostgreSQL query function",
      artifact: "postgres/003_queries.sql",
      objectName: fn,
      source: query.span,
    });
    entries.push({
      id: `disclose:${query.id}`,
      purpose: `Disclose only projection closure ${closure.map((projection) => projection.id).join(" -> ")} through the generated query boundary.`,
      layer: "PostgreSQL projection encoder",
      artifact: "postgres/003_queries.sql",
      objectName: fn,
      source: query.span,
    });
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
  entries.push({ id: "boundary:decision_evidence", purpose: "Record private model/source identity, stable decision rule and policy authority, and executed outcome transactionally with action audit.", layer: "PostgreSQL audit", artifact: "postgres/003_actions.sql", objectName: `${internalSchema}.action_audit.decision_evidence` });
  entries.push({ id: "boundary:command_receipts", purpose: "Keep idempotency keys, request fingerprints, correlations, stored results, and audit links private and transactional.", layer: "PostgreSQL receipt boundary", artifact: "postgres/002_schema.sql", objectName: `${internalSchema}.command_receipt` });
  entries.push({ id: "boundary:event_outbox", purpose: "Commit domain events atomically with state, audit, evidence, and receipts, then deliver them through private leases with at-least-once semantics.", layer: "PostgreSQL transactional outbox", artifact: "postgres/002_schema.sql", objectName: `${internalSchema}.event_outbox` });
  entries.push({ id: "boundary:event_inbox", purpose: "Commit consumer deduplication, validation, local effect, audit evidence, and stored result atomically.", layer: "PostgreSQL transactional inbox", artifact: "postgres/002_schema.sql", objectName: `${internalSchema}.event_inbox` });
  return entries;
}
