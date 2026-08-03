import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { ModelError, internalSpan } from "./diagnostics.js";
import type { ModelIR } from "./ir.js";

const schemaCandidates = [
  new URL("../schemas/model-ir.schema.json", import.meta.url),
  new URL("../../schemas/model-ir.schema.json", import.meta.url),
];
const schemaUrl = schemaCandidates.find((candidate) => existsSync(fileURLToPath(candidate)));
if (!schemaUrl) throw new Error("E4008 Cannot locate schemas/model-ir.schema.json");
const schema = JSON.parse(readFileSync(schemaUrl, "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const evolutionSchema = JSON.parse(JSON.stringify(schema)) as {
  required: string[];
  $defs: { query: { required: string[] } };
};
evolutionSchema.required = evolutionSchema.required.filter((name) => name !== "projections");
evolutionSchema.$defs.query.required = evolutionSchema.$defs.query.required.filter((name) => name !== "returnProjectionId");
const validateEvolution = new Ajv2020({ allErrors: true, strict: true }).compile(evolutionSchema);

export function validateIR(ir: ModelIR): void {
  const sourceFile = ir.model.sourceFile;
  if (!validate(ir as unknown)) {
    const detail = validate.errors?.map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "unknown schema failure";
    throw new ModelError("E3002", `Canonical IR failed model-ir.schema.json validation: ${detail}`, internalSpan(), sourceFile);
  }
}

export function validateEvolutionIR(ir: ModelIR): void {
  const legacy = ir as unknown as { irVersion?: unknown; policies?: unknown };
  const irVersion = Number(legacy.irVersion);
  if (![9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(irVersion)) {
    throw new ModelError(
      "E3002",
      `Evolution input must use released canonical IR9 through IR25; received '${String(legacy.irVersion)}'.`,
      internalSpan(),
      ir.model?.sourceFile,
    );
  }
  if (irVersion === 25) {
    validateIR(ir);
    return;
  }
  const normalized = {
    ...(ir as unknown as Record<string, unknown>),
    irVersion: 25,
    ...(irVersion === 9 && legacy.policies === undefined ? { policies: [] } : {}),
    ...(irVersion < 12 && (legacy as { events?: unknown }).events === undefined ? { events: [] } : {}),
    ...(irVersion < 13 ? { consumers: [] } : {}),
    events: ((ir as unknown as { events?: ModelIR["events"] }).events ?? []).map((event) => ({
      ...event,
      ...(irVersion < 13 && !("source" in event) ? { source: { kind: "local" as const } } : {}),
      publicationFailurePolicy: irVersion < 17 && !("publicationFailurePolicy" in event)
        ? { mode: "unboundedRetry" as const }
        : event.publicationFailurePolicy.mode === "deadLetterAfterMaxAttempts"
          ? { ...event.publicationFailurePolicy, recovery: event.publicationFailurePolicy.recovery ?? "none" as const }
          : event.publicationFailurePolicy,
    })),
    actions: (ir as unknown as ModelIR).actions.map((action) => ({
      ...action,
      ...(irVersion < 12 && !("emittedEventIds" in action) ? { emittedEventIds: [] } : {}),
    })),
    consumers: ((ir as unknown as { consumers?: ModelIR["consumers"] }).consumers ?? []).map((consumer) => {
      const failurePolicy = irVersion < 15 && !("failurePolicy" in consumer)
        ? { mode: "unboundedRetry" as const }
        : consumer.failurePolicy.mode === "deadLetterAfterMaxAttempts"
          ? { ...consumer.failurePolicy, recovery: consumer.failurePolicy.recovery ?? "none" as const }
          : consumer.failurePolicy;
      return {
        ...consumer,
        ...(irVersion < 14 && !("emittedEventIds" in consumer) ? { emittedEventIds: [] } : {}),
        failurePolicy,
      };
    }),
  } as unknown as ModelIR;
  if (!validateEvolution(normalized as unknown)) {
    const detail = validateEvolution.errors?.map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "unknown schema failure";
    throw new ModelError("E3002", `Evolution IR failed released schema normalization: ${detail}`, internalSpan(), ir.model?.sourceFile);
  }
}
