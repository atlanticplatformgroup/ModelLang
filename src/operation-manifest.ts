import type { IRAction, IRQuery, ModelIR } from "./ir.js";
import { isMoneyType, moneyProfileFromType } from "./money.js";

export type OperationScalar = "String" | "Int" | "Decimal" | "Boolean" | "UUID" | "DateTime";

export type OperationValueType =
  | { kind: "scalar"; name: OperationScalar }
  | { kind: "entity"; entityId: string }
  | { kind: "enum"; enumId: string }
  | { kind: "enumSet"; enumId: string }
  | { kind: "money"; currency: string; precision: number; scale: number };

export interface OperationManifest {
  $schema: "https://modellang.dev/schemas/operation-manifest.schema.json";
  manifestVersion: 3;
  model: {
    id: string;
    name: string;
    version: string;
    sourceHash: string;
  };
  authentication: {
    required: true;
    source: "authenticatedContext";
    principalEntityId: string;
    requestSupplied: false;
  };
  enums: {
    id: string;
    name: string;
    members: { id: string; name: string; value: string }[];
  }[];
  entities: {
    id: string;
    name: string;
    idFieldId: string;
    fields: {
      id: string;
      name: string;
      type: OperationValueType;
      nullable: boolean;
      generated?: "uuid" | "now";
      immutable: boolean;
      snapshot: boolean;
    }[];
  }[];
  operations: ManifestOperation[];
  workflows: ManifestWorkflow[];
}

export interface ManifestParameter {
  id: string;
  name: string;
  type: OperationValueType;
}

export function operationInputName(operation: Pick<ManifestOperation, "name">): string {
  return `${operation.name[0]!.toUpperCase()}${operation.name.slice(1)}Input`;
}

export type ManifestErrorKind =
  | "identityBinding"
  | "authorization"
  | "precondition"
  | "transition"
  | "invariant"
  | "conflict"
  | "idempotency"
  | "notFound"
  | "validation";

interface ManifestOperationBase {
  id: string;
  name: string;
  input: ManifestParameter[];
  caller: {
    parameterId: string;
    entityId: string;
    source: "authenticatedContext";
    requestSupplied: false;
  };
  errors: ManifestErrorKind[];
}

export type ManifestOperation =
  | (ManifestOperationBase & {
      kind: "action";
      output: { entityId: string; cardinality: "one" };
      reliability: {
        idempotency: "required" | "unsupported";
        scope: "authenticatedPrincipal";
        replay: "storedResult" | "none";
        fingerprint: "canonicalSha256" | "none";
      };
    })
  | (ManifestOperationBase & {
      kind: "query";
      output: { entityId: string; cardinality: "many"; maxItems: number };
    });

export interface ManifestWorkflowTarget {
  source: "operationInput";
  parameterId: string;
  name: string;
}

export interface ManifestWorkflow {
  id: string;
  name: string;
  entityId: string;
  fieldId: string;
  enumId: string;
  initialMemberId: string;
  transitions: {
    id: string;
    name: string;
    fromMemberId: string;
    toMemberId: string;
    actionId: string;
    target: ManifestWorkflowTarget;
  }[];
}

export function operationValueType(type: string): OperationValueType {
  if (type.startsWith("entity:")) return { kind: "entity", entityId: type };
  if (type.startsWith("set:enum:")) return { kind: "enumSet", enumId: type.slice("set:".length) };
  if (type.startsWith("enum:")) return { kind: "enum", enumId: type };
  if (isMoneyType(type)) {
    const profile = moneyProfileFromType(type)!;
    return {
      kind: "money",
      currency: profile.currency,
      precision: profile.precision,
      scale: profile.scale,
    };
  }
  return { kind: "scalar", name: type as OperationScalar };
}

function callableInput(operation: IRAction | IRQuery): ManifestParameter[] {
  return operation.callableParameters.map((id) => {
    const parameter = operation.parameters.find((candidate) => candidate.id === id);
    if (!parameter) throw new Error(`E6001 Missing callable parameter '${id}' in operation '${operation.id}'.`);
    return { id: parameter.id, name: parameter.name, type: operationValueType(parameter.type) };
  });
}

function caller(operation: IRAction | IRQuery, ir: ModelIR): ManifestOperationBase["caller"] {
  const parameter = operation.parameters.find((candidate) => candidate.id === operation.callerParameterId);
  if (!parameter?.caller || parameter.binding !== "session_user") {
    throw new Error(`E6002 Operation '${operation.id}' has no authenticated caller binding.`);
  }
  return {
    parameterId: parameter.id,
    entityId: ir.principal.entityId,
    source: "authenticatedContext",
    requestSupplied: false,
  };
}

function actionErrors(ir: ModelIR, action: IRAction): ManifestErrorKind[] {
  const errors: ManifestErrorKind[] = ["identityBinding", "authorization"];
  if (action.idempotency) errors.push("idempotency");
  if (action.preconditions.length > 0) errors.push("precondition");
  if (action.parameters.some((parameter) => action.callableParameters.includes(parameter.id) && isMoneyType(parameter.type))) {
    errors.push("validation");
  }
  if (ir.workflows.some((workflow) => workflow.transitions.some((transition) => transition.actionId === action.id))) {
    errors.push("transition");
  }
  const entity = ir.entities.find((candidate) => candidate.id === action.returnEntityId);
  if (entity && (entity.invariants.length > 0 || entity.fields.some((field) => field.annotations.length > 0))) {
    errors.push("invariant");
  }
  if (entity?.temporalExclusions.length) errors.push("conflict");
  return errors;
}

function queryErrors(query: IRQuery): ManifestErrorKind[] {
  const errors: ManifestErrorKind[] = ["identityBinding", "authorization"];
  if (query.parameters.some((parameter) => query.callableParameters.includes(parameter.id) && isMoneyType(parameter.type))) {
    errors.push("validation");
  }
  return errors;
}

function manifestWorkflows(ir: ModelIR): ManifestWorkflow[] {
  return ir.workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    entityId: workflow.entityId,
    fieldId: workflow.fieldId,
    enumId: workflow.enumId,
    initialMemberId: workflow.initialMemberId,
    transitions: workflow.transitions.map((transition) => {
      const action = ir.actions.find((candidate) => candidate.id === transition.actionId);
      if (!action || action.effect.kind !== "update") {
        throw new Error(`E6003 Workflow transition '${transition.id}' has no update action '${transition.actionId}'.`);
      }
      const parameter = action.parameters.find((candidate) => candidate.name === action.effect.target);
      if (!parameter) {
        throw new Error(`E6004 Workflow action '${action.id}' has no target parameter '${action.effect.target}'.`);
      }
      if (parameter.caller || !action.callableParameters.includes(parameter.id)) {
        throw new Error(`E6005 Workflow target '${parameter.id}' is not callable input.`);
      }
      return {
        id: transition.id,
        name: transition.name,
        fromMemberId: transition.fromMemberId,
        toMemberId: transition.toMemberId,
        actionId: transition.actionId,
        target: { source: "operationInput", parameterId: parameter.id, name: parameter.name },
      };
    }),
  }));
}

export function generateOperationManifest(ir: ModelIR): OperationManifest {
  return {
    $schema: "https://modellang.dev/schemas/operation-manifest.schema.json",
    manifestVersion: 3,
    model: {
      id: ir.model.id,
      name: ir.model.name,
      version: ir.model.version,
      sourceHash: ir.model.sourceHash,
    },
    authentication: {
      required: true,
      source: "authenticatedContext",
      principalEntityId: ir.principal.entityId,
      requestSupplied: false,
    },
    enums: ir.enums.map((enumeration) => ({
      id: enumeration.id,
      name: enumeration.name,
      members: enumeration.members.map((member) => ({
        id: member.id,
        name: member.name,
        value: member.naming.typescriptValue,
      })),
    })),
    entities: ir.entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      idFieldId: entity.idFieldId,
      fields: entity.fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: operationValueType(field.type),
        nullable: field.optional,
        ...(field.generation ? { generated: field.generation.strategy } : {}),
        immutable: field.mutability === "immutable",
        snapshot: field.storage === "snapshot",
      })),
    })),
    operations: [
      ...ir.actions.map((action): ManifestOperation => ({
        id: action.id,
        name: action.name,
        kind: "action",
        input: callableInput(action),
        caller: caller(action, ir),
        output: { entityId: action.returnEntityId, cardinality: "one" },
        reliability: action.idempotency ? {
          idempotency: "required",
          scope: "authenticatedPrincipal",
          replay: "storedResult",
          fingerprint: "canonicalSha256",
        } : {
          idempotency: "unsupported",
          scope: "authenticatedPrincipal",
          replay: "none",
          fingerprint: "none",
        },
        errors: actionErrors(ir, action),
      })),
      ...ir.queries.map((query): ManifestOperation => ({
        id: query.id,
        name: query.name,
        kind: "query",
        input: callableInput(query),
        caller: caller(query, ir),
        output: { entityId: query.sourceEntityId, cardinality: "many", maxItems: query.limit },
        errors: queryErrors(query),
      })),
    ],
    workflows: manifestWorkflows(ir),
  };
}
