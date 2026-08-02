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
  required: boolean;
  nullable: boolean;
  presentation: UiPresentation;
}

export interface UiWorkflowTarget {
  source: "operationInput";
  parameterId: string;
  name: string;
}

export interface UiWorkflowTransition {
  transitionId: string;
  name: string;
  label: string;
  fromMemberId: string;
  fromValue: string;
  toMemberId: string;
  toValue: string;
  actionOperationId: string;
  target: UiWorkflowTarget;
  fields: UiInputField[];
}

export interface UiWorkflow {
  workflowId: string;
  name: string;
  label: string;
  entityId: string;
  stateFieldId: string;
  enumId: string;
  initialMemberId: string;
  states: {
    memberId: string;
    value: string;
    label: string;
    initial: boolean;
    terminal: boolean;
  }[];
  transitions: UiWorkflowTransition[];
}

export interface UiManifest {
  $schema: "https://modellang.dev/schemas/ui-manifest.schema.json";
  uiManifestVersion: 8;
  operationManifestVersion: 8;
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
    idFieldId: string;
    fields: {
      fieldId: string;
      name: string;
      label: string;
      presentation: UiPresentation;
      nullable: boolean;
      nestedProjectionId?: string;
      generated?: "uuid" | "now";
      immutable: boolean;
      snapshot: boolean;
    }[];
  }[];
  projections: {
    id: string;
    name: string;
    label: string;
    sourceEntityId: string;
    fields: {
      projectionFieldId: string;
      sourceFieldId: string;
      name: string;
      label: string;
      presentation: UiPresentation;
      nullable: boolean;
    }[];
  }[];
  actions: {
    operationId: string;
    name: string;
    label: string;
    fields: UiInputField[];
    resultEntityId: string;
    errors: ManifestErrorKind[];
    reliability: {
      idempotency: "required" | "unsupported";
      scope: "authenticatedPrincipal";
    };
    emittedEventIds: string[];
  }[];
  queries: {
    operationId: string;
    name: string;
    label: string;
    filters: UiInputField[];
    resultProjectionId: string;
    maxItems: number;
    pagination?: {
      kind: "cursor";
      cursorInput: "cursor";
      queryRevision: string;
    };
    errors: ManifestErrorKind[];
  }[];
  workflows: UiWorkflow[];
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
    required: !parameter.optional,
    nullable: parameter.optional === true,
    presentation: uiPresentation(parameter.type),
  }));
}

export function generateUiManifest(manifest: OperationManifest): UiManifest {
  if (manifest.manifestVersion !== 8) {
    throw new Error(`E6201 UI generation requires operation manifest version 8, received '${manifest.manifestVersion}'.`);
  }
  return {
    $schema: "https://modellang.dev/schemas/ui-manifest.schema.json",
    uiManifestVersion: 8,
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
      idFieldId: entity.idFieldId,
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
    projections: manifest.projections.map((projection) => ({
      id: projection.id,
      name: projection.name,
      label: uiLabel(projection.name),
      sourceEntityId: projection.sourceEntityId,
      fields: projection.fields.map((field) => ({
        projectionFieldId: field.id,
        sourceFieldId: field.sourceFieldId,
        name: field.name,
        label: uiLabel(field.name),
        presentation: uiPresentation(field.type),
        nullable: field.nullable,
        ...(field.nestedProjectionId ? { nestedProjectionId: field.nestedProjectionId } : {}),
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
        reliability: {
          idempotency: operation.reliability.idempotency,
          scope: operation.reliability.scope,
        },
        emittedEventIds: [...operation.emittedEventIds],
      })),
    queries: manifest.operations
      .filter((operation) => operation.kind === "query")
      .map((operation) => ({
        operationId: operation.id,
        name: operation.name,
        label: uiLabel(operation.name),
        filters: inputFields(operation),
        resultProjectionId: operation.output.projectionId,
        maxItems: operation.output.maxItems,
        ...(operation.output.cardinality === "page" ? {
          pagination: {
            kind: operation.output.pagination.kind,
            cursorInput: operation.output.pagination.cursorInput,
            queryRevision: operation.output.pagination.queryRevision,
          },
        } : {}),
        errors: operation.errors,
      })),
    workflows: manifest.workflows.map((workflow) => {
      const enumeration = manifest.enums.find((candidate) => candidate.id === workflow.enumId);
      if (!enumeration) throw new Error(`E6203 Missing UI workflow enum '${workflow.enumId}'.`);
      const member = (memberId: string) => {
        const result = enumeration.members.find((candidate) => candidate.id === memberId);
        if (!result) throw new Error(`E6204 Missing UI workflow member '${memberId}'.`);
        return result;
      };
      const transitions: UiWorkflowTransition[] = workflow.transitions.map((transition) => {
        const action = manifest.operations.find((candidate) => candidate.id === transition.actionId && candidate.kind === "action");
        if (!action || action.kind !== "action") {
          throw new Error(`E6205 Missing UI workflow action '${transition.actionId}'.`);
        }
        const from = member(transition.fromMemberId);
        const to = member(transition.toMemberId);
        return {
          transitionId: transition.id,
          name: transition.name,
          label: uiLabel(transition.name),
          fromMemberId: from.id,
          fromValue: from.value,
          toMemberId: to.id,
          toValue: to.value,
          actionOperationId: action.id,
          target: transition.target,
          fields: inputFields(action).filter((field) => field.parameterId !== transition.target.parameterId),
        };
      });
      return {
        workflowId: workflow.id,
        name: workflow.name,
        label: uiLabel(workflow.name),
        entityId: workflow.entityId,
        stateFieldId: workflow.fieldId,
        enumId: workflow.enumId,
        initialMemberId: workflow.initialMemberId,
        states: enumeration.members.map((state) => ({
          memberId: state.id,
          value: state.value,
          label: uiLabel(state.name),
          initial: state.id === workflow.initialMemberId,
          terminal: !workflow.transitions.some((transition) => transition.fromMemberId === state.id),
        })),
        transitions,
      };
    }),
  };
}
