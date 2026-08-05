import type { ModelIR } from "./ir.js";
import { MODELLANG_COMPILER_VERSION, MODELLANG_GENERATOR_PROFILE, MODELLANG_TARGET_PROFILE } from "./version.js";

export type TargetCapabilitySupport = "native" | "externalImplementationRequired";

export interface TargetCapabilityReport {
  $schema: "https://modellang.dev/schemas/target-capability-profile.schema.json";
  profileVersion: 8;
  compilerVersion: string;
  generatorProfile: string;
  targetProfile: "target:postgresql-http-ui-public-decision-traces/8";
  irVersion: 1;
  model: { id: string; version: string; sourceHash: string };
  conformance: "complete" | "requiresExternalImplementations";
  authority: "none";
  capabilities: {
    id: string;
    required: boolean;
    support: TargetCapabilitySupport;
    enforcement: string[];
  }[];
  gaps: {
    extensionId: string;
    capabilityId: "extensions.declaredExternal";
    reason: string;
    implementation: { target: string; location: string };
  }[];
}

export function generateTargetCapabilityReport(ir: ModelIR): TargetCapabilityReport {
  const capabilities: TargetCapabilityReport["capabilities"] = [
    { id: "core.stableIdentity", required: true, support: "native", enforcement: ["compiler", "canonical-ir", "semantic-diff"] },
    { id: "core.typedState", required: true, support: "native", enforcement: ["compiler", "postgresql", "typescript"] },
    { id: "operations.authenticatedActions", required: ir.actions.length > 0, support: "native", enforcement: ["postgresql", "http"] },
    { id: "operations.reliableCommands", required: ir.actions.some((action) => Boolean(action.idempotency)), support: "native", enforcement: ["postgresql", "http"] },
    { id: "policy.closedBoolean", required: ir.policies.length > 0, support: "native", enforcement: ["compiler", "postgresql"] },
    { id: "events.transactionalOutbox", required: ir.events.some((event) => event.source.kind === "local"), support: "native", enforcement: ["postgresql", "typescript"] },
    { id: "events.transactionalConsumers", required: ir.consumers.length > 0, support: "native", enforcement: ["postgresql", "typescript"] },
    { id: "queries.closedProjections", required: ir.queries.length > 0, support: "native", enforcement: ["postgresql", "http", "ui-metadata"] },
    { id: "queries.toOneTraversal", required: ir.projections.some((projection) => projection.fields.some((field) => Boolean(field.nestedProjectionId))), support: "native", enforcement: ["compiler", "postgresql", "http"] },
    { id: "queries.optionalFilters", required: ir.queries.some((query) => query.parameters.some((parameter) => Boolean(parameter.optional))), support: "native", enforcement: ["compiler", "postgresql", "http"] },
    { id: "queries.authoredSortProfiles", required: ir.queries.some((query) => Boolean(query.sortProfiles?.length)), support: "native", enforcement: ["compiler", "postgresql", "http"] },
    { id: "queries.cursorPagination", required: ir.queries.some((query) => Boolean(query.pagination)), support: "native", enforcement: ["postgresql", "http"] },
    { id: "queries.conditionalDisclosure", required: ir.queries.some((query) => Boolean(query.disclosures?.length)), support: "native", enforcement: ["compiler", "postgresql", "http"] },
    { id: "queries.transactionalReadEvidence", required: ir.queries.some((query) => Boolean(query.readEvidence)), support: "native", enforcement: ["postgresql"] },
    { id: "agents.staticToolCatalog", required: true, support: "native", enforcement: ["agent-tool-catalog", "http"] },
    { id: "agents.subjectCapabilityView", required: ir.actions.length > 0, support: "native", enforcement: ["agent-tool-catalog", "http", "postgresql-applicability"] },
    { id: "agents.currentStateResources", required: ir.queries.length > 0, support: "native", enforcement: ["agent-tool-catalog", "http", "postgresql-query"] },
    { id: "agents.mcpAdapter", required: true, support: "native", enforcement: ["mcp", "agent-tool-catalog", "postgresql-runtime"] },
    { id: "agents.taskPackets", required: true, support: "native", enforcement: ["agent-task-packet", "http", "mcp", "postgresql-runtime"] },
    { id: "agents.delegatedCapabilities", required: ir.actions.length > 0, support: "native", enforcement: ["delegated-capability", "http", "mcp", "host-credential-authority", "postgresql-runtime"] },
    { id: "agents.publicDecisionTraces", required: ir.actions.length > 0, support: "native", enforcement: ["public-decision-trace", "http", "mcp", "postgresql-applicability"] },
    { id: "extensions.declaredExternal", required: ir.extensions.length > 0, support: "externalImplementationRequired", enforcement: ["extension-ledger", "host-conformance-tests"] },
  ];
  const gaps = ir.extensions.map((extension) => ({
    extensionId: extension.id,
    capabilityId: "extensions.declaredExternal" as const,
    reason: extension.reason,
    implementation: extension.implementation,
  }));
  return {
    $schema: "https://modellang.dev/schemas/target-capability-profile.schema.json",
    profileVersion: 8,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    generatorProfile: MODELLANG_GENERATOR_PROFILE,
    targetProfile: MODELLANG_TARGET_PROFILE,
    irVersion: ir.irVersion,
    model: { id: ir.model.id, version: ir.model.version, sourceHash: ir.model.sourceHash },
    conformance: gaps.length ? "requiresExternalImplementations" : "complete",
    authority: "none",
    capabilities,
    gaps,
  };
}
