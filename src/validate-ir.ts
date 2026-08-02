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
  if (![9, 10, 11].includes(irVersion)) {
    throw new ModelError(
      "E3002",
      `Evolution input must use released canonical IR9, IR10, or IR11; received '${String(legacy.irVersion)}'.`,
      internalSpan(),
      ir.model?.sourceFile,
    );
  }
  const normalized = {
    ...(ir as unknown as Record<string, unknown>),
    irVersion: 11,
    ...(irVersion === 9 && legacy.policies === undefined ? { policies: [] } : {}),
  } as unknown as ModelIR;
  validateIR(normalized);
}
