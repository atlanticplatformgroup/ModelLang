import type { DecisionPlan } from "./decision-plan.js";
import type { OperationManifest } from "./operation-manifest.js";

function actionIdempotency(operations: OperationManifest, operationId: string): "required" | "unsupported" {
  const operation = operations.operations.find((candidate) => candidate.id === operationId);
  return operation?.kind === "action" ? operation.reliability.idempotency : "unsupported";
}

function actionEventIds(operations: OperationManifest, operationId: string): string[] {
  const operation = operations.operations.find((candidate) => candidate.id === operationId);
  return operation?.kind === "action" ? [...operation.emittedEventIds] : [];
}

export interface CapabilityManifest {
  $schema: "https://modellang.dev/schemas/capability-manifest.schema.json";
  capabilityManifestVersion: 3;
  operationManifestVersion: 4;
  model: { id: string; name: string; version: string; sourceHash: string };
  view: {
    audience: "application";
    safeProjection: true;
    containsExpressions: false;
    containsCurrentState: false;
    grantsAuthority: false;
  };
  authentication: { required: true; callerInput: false };
  actions: {
    operationId: string;
    inputParameterIds: string[];
    outcomes: ["applicable", "denied", "notApplicable", "stale"];
    explanation: {
      safe: true;
      authorizationRuleId: string;
      preconditionRuleIds: string[];
      revisionRuleId: string;
    };
    revision: {
      kind: "opaque";
      staleRequiresExpectedRevision: true;
      grantsAuthority: false;
    };
    reliability: {
      idempotency: "required" | "unsupported";
      scope: "authenticatedPrincipal";
      grantsAuthority: false;
    };
    emittedEventIds: string[];
  }[];
}

export function generateCapabilityManifest(
  operations: OperationManifest,
  decisions: DecisionPlan,
): CapabilityManifest {
  return {
    $schema: "https://modellang.dev/schemas/capability-manifest.schema.json",
    capabilityManifestVersion: 3,
    operationManifestVersion: operations.manifestVersion,
    model: { ...operations.model },
    view: {
      audience: "application",
      safeProjection: true,
      containsExpressions: false,
      containsCurrentState: false,
      grantsAuthority: false,
    },
    authentication: { required: true, callerInput: false },
    actions: decisions.actions.map((decision) => ({
      operationId: decision.operationId,
      inputParameterIds: [...decision.callableParameterIds],
      outcomes: ["applicable", "denied", "notApplicable", "stale"],
      explanation: {
        safe: true,
        authorizationRuleId: decision.authorization.id,
        preconditionRuleIds: decision.preconditions.map((rule) => rule.id),
        revisionRuleId: decision.revision.ruleId,
      },
      revision: {
        kind: "opaque",
        staleRequiresExpectedRevision: true,
        grantsAuthority: false,
      },
      reliability: {
        idempotency: actionIdempotency(operations, decision.operationId),
        scope: "authenticatedPrincipal",
        grantsAuthority: false,
      },
      emittedEventIds: actionEventIds(operations, decision.operationId),
    })),
  };
}
