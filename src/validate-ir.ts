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
  for (const action of ir.actions) {
    const updateTargets = new Set<string>();
    action.effects.forEach((effect, index) => {
      const expectedId = `effect:${action.id}.${index}`;
      if (effect.order !== index || effect.id !== expectedId) {
        throw new ModelError("E3002", `Canonical IR action '${action.id}' must use contiguous effect order and deterministic effect IDs; expected '${expectedId}' at order ${index}.`, internalSpan(), sourceFile);
      }
      if (effect.kind === "update") {
        const target = action.parameters.find((parameter) => parameter.name === effect.target);
        if (!target || target.caller || target.type !== effect.entityId || updateTargets.has(target.id)) {
          throw new ModelError("E3002", `Canonical IR action '${action.id}' has an invalid or repeated update target '${effect.target}'.`, internalSpan(), sourceFile);
        }
        updateTargets.add(target.id);
      }
    });
    if (action.effects.at(-1)?.entityId !== action.returnEntityId) {
      throw new ModelError("E3002", `Canonical IR action '${action.id}' final effect must produce '${action.returnEntityId}'.`, internalSpan(), sourceFile);
    }
  }
}
