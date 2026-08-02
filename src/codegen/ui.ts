import { stableJson } from "../ir.js";
import { operationInputName } from "../operation-manifest.js";
import type { OperationManifest } from "../operation-manifest.js";
import type { UiManifest } from "../ui-manifest.js";

export interface UiOutput {
  "typescript/ui.ts": string;
}

function resultType(manifest: OperationManifest, operation: OperationManifest["operations"][number]): string {
  if (operation.kind === "action") {
    const entity = manifest.entities.find((candidate) => candidate.id === operation.output.entityId);
    if (!entity) throw new Error(`E6202 Missing UI result entity '${operation.output.entityId}'.`);
    return entity.name;
  }
  const projection = manifest.projections.find((candidate) => candidate.id === operation.output.projectionId);
  if (!projection) throw new Error(`E6206 Missing UI result projection '${operation.output.projectionId}'.`);
  return `${projection.name}[]`;
}

function resultImportType(manifest: OperationManifest, operation: OperationManifest["operations"][number]): string {
  return resultType(manifest, operation).replace(/\[\]$/, "");
}

export function generateUi(manifest: OperationManifest, uiManifest: UiManifest): UiOutput {
  const workflowEnums = manifest.workflows.map((workflow) => {
    const enumeration = manifest.enums.find((candidate) => candidate.id === workflow.enumId);
    if (!enumeration) throw new Error(`E6203 Missing UI workflow enum '${workflow.enumId}'.`);
    return enumeration.name;
  });
  const imports = [...new Set([
    ...manifest.operations.map((operation) => resultImportType(manifest, operation)),
    ...manifest.operations.map(operationInputName),
    ...workflowEnums,
    "ApplicabilityDecision",
    "ApplicabilityOptions",
    "ExecutionOptions",
  ])];
  const operationIds = manifest.operations.map((operation) => JSON.stringify(operation.id)).join(" | ");
  const actionIds = manifest.operations.filter((operation) => operation.kind === "action").map((operation) => JSON.stringify(operation.id)).join(" | ") || "never";
  const inputMap = manifest.operations.map((operation) =>
    `  ${JSON.stringify(operation.id)}: ${operationInputName(operation)};`,
  ).join("\n");
  const resultMap = manifest.operations.map((operation) =>
    `  ${JSON.stringify(operation.id)}: ${resultType(manifest, operation)};`,
  ).join("\n");
  const dispatch = manifest.operations.map((operation) =>
    `        case ${JSON.stringify(operation.id)}:\n          return await client.${operation.name}(input as unknown as ${operationInputName(operation)}${operation.kind === "action" ? ", options" : ""}) as ${manifest.model.name}UiResultByOperationId[Id];`,
  ).join("\n");
  const assessDispatch = manifest.operations.filter((operation) => operation.kind === "action").map((operation) =>
    `        case ${JSON.stringify(operation.id)}:\n          return await client.assess${operation.name[0]!.toUpperCase()}${operation.name.slice(1)}(input as unknown as ${operationInputName(operation)}, options);`,
  ).join("\n");
  const workflowIds = manifest.workflows.length
    ? manifest.workflows.map((workflow) => JSON.stringify(workflow.id)).join(" | ")
    : "never";
  const transitions = manifest.workflows.flatMap((workflow) => workflow.transitions);
  const transitionIds = transitions.length
    ? transitions.map((transition) => JSON.stringify(transition.id)).join(" | ")
    : "never";
  const workflowStateMap = manifest.workflows.map((workflow) => {
    const enumeration = manifest.enums.find((candidate) => candidate.id === workflow.enumId)!;
    return `  ${JSON.stringify(workflow.id)}: ${enumeration.name};`;
  }).join("\n");
  const transitionInputMap = transitions.map((transition) => {
    const action = manifest.operations.find((candidate) => candidate.id === transition.actionId && candidate.kind === "action")!;
    const input = operationInputName(action);
    const type = `Omit<${input}, ${JSON.stringify(transition.target.name)}>`;
    return `  ${JSON.stringify(transition.id)}: ${type};`;
  }).join("\n");
  const transitionResultMap = transitions.map((transition) => {
    const action = manifest.operations.find((candidate) => candidate.id === transition.actionId && candidate.kind === "action")!;
    return `  ${JSON.stringify(transition.id)}: ${resultType(manifest, action)};`;
  }).join("\n");
  const transitionDispatch = transitions.map((transition) => {
    const action = manifest.operations.find((candidate) => candidate.id === transition.actionId && candidate.kind === "action")!;
    return `        case ${JSON.stringify(transition.id)}:\n          return await client.${action.name}({ ...(input as object), [${JSON.stringify(transition.target.name)}]: targetId } as unknown as ${operationInputName(action)}, options) as ${manifest.model.name}UiTransitionResultById[Id];`;
  }).join("\n");
  const transitionAssessDispatch = transitions.map((transition) => {
    const action = manifest.operations.find((candidate) => candidate.id === transition.actionId && candidate.kind === "action")!;
    return `        case ${JSON.stringify(transition.id)}:\n          return await client.assess${action.name[0]!.toUpperCase()}${action.name.slice(1)}({ ...(input as object), [${JSON.stringify(transition.target.name)}]: targetId } as unknown as ${operationInputName(action)}, options);`;
  }).join("\n");
  return {
    "typescript/ui.ts": `// Generated by ModelLang. Do not edit.
import type { ${imports.join(", ")} } from "./types.js";
import { ValidationError } from "./errors.js";
import { ${manifest.model.name}HttpClient } from "./http-client.js";

/** Framework-neutral descriptors. Labels are generated defaults; stable IDs are binding keys. */
export const ${manifest.model.name}UiManifest = ${stableJson(uiManifest).trimEnd()} as const;

export type ${manifest.model.name}UiOperationId = ${operationIds};
export type ${manifest.model.name}UiActionOperationId = ${actionIds};

export interface ${manifest.model.name}UiInputByOperationId {
${inputMap}
}

export interface ${manifest.model.name}UiResultByOperationId {
${resultMap}
}

export interface ${manifest.model.name}UiExecutor {
  execute<Id extends ${manifest.model.name}UiOperationId>(
    operationId: Id,
    input: ${manifest.model.name}UiInputByOperationId[Id],
    options?: ExecutionOptions,
  ): Promise<${manifest.model.name}UiResultByOperationId[Id]>;
  assess<Id extends ${manifest.model.name}UiActionOperationId>(
    operationId: Id,
    input: ${manifest.model.name}UiInputByOperationId[Id],
    options?: ApplicabilityOptions,
  ): Promise<ApplicabilityDecision>;
}

/** Execute a manifest operation through the authenticated HTTP client. */
export function create${manifest.model.name}UiExecutor(client: ${manifest.model.name}HttpClient): ${manifest.model.name}UiExecutor {
  return {
    async execute<Id extends ${manifest.model.name}UiOperationId>(
      operationId: Id,
      input: ${manifest.model.name}UiInputByOperationId[Id],
      options: ExecutionOptions = {},
    ): Promise<${manifest.model.name}UiResultByOperationId[Id]> {
      switch (operationId) {
${dispatch}
        default:
          throw new ValidationError("Unknown ModelLang UI operation", "ML_UI_OPERATION_NOT_FOUND", "ui:operation");
      }
    },
    async assess<Id extends ${manifest.model.name}UiActionOperationId>(
      operationId: Id,
      input: ${manifest.model.name}UiInputByOperationId[Id],
      options: ApplicabilityOptions = {},
    ): Promise<ApplicabilityDecision> {
      switch (operationId) {
${assessDispatch}
        default:
          throw new ValidationError("Unknown ModelLang UI action", "ML_UI_OPERATION_NOT_FOUND", "ui:operation");
      }
    },
  };
}

export type ${manifest.model.name}UiWorkflowId = ${workflowIds};
export type ${manifest.model.name}UiTransitionId = ${transitionIds};
export type ${manifest.model.name}UiWorkflow = (typeof ${manifest.model.name}UiManifest.workflows)[number];
export type ${manifest.model.name}UiWorkflowTransition =
  ${manifest.model.name}UiWorkflow extends { transitions: readonly (infer Transition)[] } ? Transition : never;

export interface ${manifest.model.name}UiWorkflowStateById {
${workflowStateMap}
}

export interface ${manifest.model.name}UiTransitionInputById {
${transitionInputMap}
}

export interface ${manifest.model.name}UiTransitionResultById {
${transitionResultMap}
}

/** Return state-matching edges only. Authorization and preconditions remain server-enforced. */
export function available${manifest.model.name}UiTransitions<Id extends ${manifest.model.name}UiWorkflowId>(
  workflowId: Id,
  state: ${manifest.model.name}UiWorkflowStateById[Id],
): readonly ${manifest.model.name}UiWorkflowTransition[] {
  const workflows = ${manifest.model.name}UiManifest.workflows as readonly {
    workflowId: string;
    transitions: readonly { fromValue: string }[];
  }[];
  const workflow = workflows.find((candidate) => candidate.workflowId === workflowId);
  if (!workflow) throw new ValidationError("Unknown ModelLang UI workflow", "ML_UI_WORKFLOW_NOT_FOUND", "ui:workflow");
  return workflow.transitions.filter((transition) => transition.fromValue === state) as unknown as readonly ${manifest.model.name}UiWorkflowTransition[];
}

export interface ${manifest.model.name}UiWorkflowExecutor {
  available<Id extends ${manifest.model.name}UiWorkflowId>(
    workflowId: Id,
    state: ${manifest.model.name}UiWorkflowStateById[Id],
  ): readonly ${manifest.model.name}UiWorkflowTransition[];
  executeTransition<Id extends ${manifest.model.name}UiTransitionId>(
    transitionId: Id,
    targetId: string,
    input: ${manifest.model.name}UiTransitionInputById[Id],
    options?: ExecutionOptions,
  ): Promise<${manifest.model.name}UiTransitionResultById[Id]>;
  assessTransition<Id extends ${manifest.model.name}UiTransitionId>(
    transitionId: Id,
    targetId: string,
    input: ${manifest.model.name}UiTransitionInputById[Id],
    options?: ApplicabilityOptions,
  ): Promise<ApplicabilityDecision>;
}

/** Bind workflow targets and execute only declared transition actions through authenticated HTTP. */
export function create${manifest.model.name}UiWorkflowExecutor(
  client: ${manifest.model.name}HttpClient,
): ${manifest.model.name}UiWorkflowExecutor {
  return {
    available: available${manifest.model.name}UiTransitions,
    async executeTransition<Id extends ${manifest.model.name}UiTransitionId>(
      transitionId: Id,
      targetId: string,
      input: ${manifest.model.name}UiTransitionInputById[Id],
      options: ExecutionOptions = {},
    ): Promise<${manifest.model.name}UiTransitionResultById[Id]> {
      switch (transitionId) {
${transitionDispatch}
        default:
          throw new ValidationError("Unknown ModelLang UI transition", "ML_UI_TRANSITION_NOT_FOUND", "ui:transition");
      }
    },
    async assessTransition<Id extends ${manifest.model.name}UiTransitionId>(
      transitionId: Id,
      targetId: string,
      input: ${manifest.model.name}UiTransitionInputById[Id],
      options: ApplicabilityOptions = {},
    ): Promise<ApplicabilityDecision> {
      switch (transitionId) {
${transitionAssessDispatch}
        default:
          throw new ValidationError("Unknown ModelLang UI transition", "ML_UI_TRANSITION_NOT_FOUND", "ui:transition");
      }
    },
  };
}
`,
  };
}
