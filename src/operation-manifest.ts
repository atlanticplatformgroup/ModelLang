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
  manifestVersion: 1;
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
    })
  | (ManifestOperationBase & {
      kind: "query";
      output: { entityId: string; cardinality: "many"; maxItems: number };
    });

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
  if (action.preconditions.length > 0) errors.push("precondition");
  if (action.parameters.some((parameter) => action.callableParameters.includes(parameter.id) && parameter.type.startsWith("entity:"))) {
    errors.push("notFound");
  }
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
  if (query.parameters.some((parameter) => query.callableParameters.includes(parameter.id) && parameter.type.startsWith("entity:"))) {
    errors.push("notFound");
  }
  if (query.parameters.some((parameter) => query.callableParameters.includes(parameter.id) && isMoneyType(parameter.type))) {
    errors.push("validation");
  }
  return errors;
}

export function generateOperationManifest(ir: ModelIR): OperationManifest {
  return {
    $schema: "https://modellang.dev/schemas/operation-manifest.schema.json",
    manifestVersion: 1,
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
  };
}
