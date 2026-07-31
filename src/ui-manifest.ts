import type {
  ManifestErrorKind,
  ManifestOperation,
  OperationManifest,
  OperationValueType,
} from "./operation-manifest.js";

export type UiPresentation =
  | { kind: "text" }
  | { kind: "integer" }
  | { kind: "decimal" }
  | { kind: "boolean" }
  | { kind: "uuid" }
  | { kind: "dateTime" }
  | { kind: "entityReference"; entityId: string }
  | { kind: "enum"; enumId: string }
  | { kind: "enumSet"; enumId: string }
  | { kind: "money"; currency: string; precision: number; scale: number };

export interface UiInputField {
  parameterId: string;
  name: string;
  label: string;
  required: true;
  presentation: UiPresentation;
}

export interface UiManifest {
  $schema: "https://modellang.dev/schemas/ui-manifest.schema.json";
  uiManifestVersion: 1;
  operationManifestVersion: 1;
  model: {
    id: string;
    name: string;
    label: string;
    version: string;
    sourceHash: string;
  };
  authentication: {
    required: true;
    callerInput: false;
  };
  enums: {
    id: string;
    name: string;
    label: string;
    options: { id: string; value: string; label: string }[];
  }[];
  entities: {
    id: string;
    name: string;
    label: string;
    fields: {
      fieldId: string;
      name: string;
      label: string;
      presentation: UiPresentation;
      nullable: boolean;
      generated?: "uuid" | "now";
      immutable: boolean;
      snapshot: boolean;
    }[];
  }[];
  actions: {
    operationId: string;
    name: string;
    label: string;
    fields: UiInputField[];
    resultEntityId: string;
    errors: ManifestErrorKind[];
  }[];
  queries: {
    operationId: string;
    name: string;
    label: string;
    filters: UiInputField[];
    resultEntityId: string;
    maxItems: number;
    errors: ManifestErrorKind[];
  }[];
}

export function uiLabel(identifier: string): string {
  const words = identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : identifier;
}

export function uiPresentation(type: OperationValueType): UiPresentation {
  if (type.kind === "entity") return { kind: "entityReference", entityId: type.entityId };
  if (type.kind === "enum") return { kind: "enum", enumId: type.enumId };
  if (type.kind === "enumSet") return { kind: "enumSet", enumId: type.enumId };
  if (type.kind === "money") return {
    kind: "money",
    currency: type.currency,
    precision: type.precision,
    scale: type.scale,
  };
  return {
    kind: ({
      String: "text",
      Int: "integer",
      Decimal: "decimal",
      Boolean: "boolean",
      UUID: "uuid",
      DateTime: "dateTime",
    } as const)[type.name],
  };
}

function inputFields(operation: ManifestOperation): UiInputField[] {
  return operation.input.map((parameter) => ({
    parameterId: parameter.id,
    name: parameter.name,
    label: uiLabel(parameter.name),
    required: true,
    presentation: uiPresentation(parameter.type),
  }));
}

export function generateUiManifest(manifest: OperationManifest): UiManifest {
  if (manifest.manifestVersion !== 1) {
    throw new Error(`E6201 UI generation requires operation manifest version 1, received '${manifest.manifestVersion}'.`);
  }
  return {
    $schema: "https://modellang.dev/schemas/ui-manifest.schema.json",
    uiManifestVersion: 1,
    operationManifestVersion: manifest.manifestVersion,
    model: {
      ...manifest.model,
      label: uiLabel(manifest.model.name),
    },
    authentication: {
      required: manifest.authentication.required,
      callerInput: false,
    },
    enums: manifest.enums.map((enumeration) => ({
      id: enumeration.id,
      name: enumeration.name,
      label: uiLabel(enumeration.name),
      options: enumeration.members.map((member) => ({
        id: member.id,
        value: member.value,
        label: uiLabel(member.name),
      })),
    })),
    entities: manifest.entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      label: uiLabel(entity.name),
      fields: entity.fields.map((field) => ({
        fieldId: field.id,
        name: field.name,
        label: uiLabel(field.name),
        presentation: uiPresentation(field.type),
        nullable: field.nullable,
        ...(field.generated ? { generated: field.generated } : {}),
        immutable: field.immutable,
        snapshot: field.snapshot,
      })),
    })),
    actions: manifest.operations
      .filter((operation) => operation.kind === "action")
      .map((operation) => ({
        operationId: operation.id,
        name: operation.name,
        label: uiLabel(operation.name),
        fields: inputFields(operation),
        resultEntityId: operation.output.entityId,
        errors: operation.errors,
      })),
    queries: manifest.operations
      .filter((operation) => operation.kind === "query")
      .map((operation) => ({
        operationId: operation.id,
        name: operation.name,
        label: uiLabel(operation.name),
        filters: inputFields(operation),
        resultEntityId: operation.output.entityId,
        maxItems: operation.output.maxItems,
        errors: operation.errors,
      })),
  };
}
