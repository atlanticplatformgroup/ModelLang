import { createHash } from "node:crypto";
import type { IRExtension, ModelIR } from "./ir.js";
import { stableJson } from "./ir.js";
import { moneyProfileFromType } from "./money.js";

export type JsonSchema = Record<string, unknown>;

export interface ExtensionRuntimeValueType {
  kind: "scalar" | "entity" | "enum" | "money";
  name?: string;
  entityId?: string;
  enumId?: string;
  currency?: string;
  precision?: number;
  scale?: number;
}

export interface AgentExtensionTool {
  id: string;
  name: string;
  description: string;
  kind: "extension";
  contractVersion: 1;
  contractRevision: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  input: { name: string; type: ExtensionRuntimeValueType; optional: boolean }[];
  result: { type: ExtensionRuntimeValueType; optional: boolean };
  execution: {
    protocol: "http";
    method: "POST";
    path: string;
    authenticated: true;
    implementation: "hostAdapterRequired";
    generatedImplementation: false;
    runtimeAuthorizationRequired: true;
  };
  authorization: {
    enforcement: "hostRequired";
    declaredContext: IRExtension["authorization"];
    callerInput: false;
  };
  effects: {
    readsModelState: boolean;
    writesModelState: boolean;
    callsExternalSystems: boolean;
    emitsEvents: boolean;
  };
  reliability: IRExtension["reliability"];
  annotations: {
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
    openWorld: true;
  };
  conformance: {
    implementationVerification: "hostResponsibility";
    testVerification: "hostResponsibility";
    discoveryGrantsAuthority: false;
    resultGrantsAuthority: false;
  };
}

function extensionSuffix(id: string): string {
  const suffix = id.slice(id.indexOf(":") + 1);
  if (!/^ext_[0-9a-f]{32}$/.test(suffix)) throw new Error(`E6801 Invalid extension tool identity '${id}'.`);
  return suffix;
}

export function extensionToolRoute(id: string): string {
  return `/agent/extensions/${extensionSuffix(id)}`;
}

function runtimeType(type: string): ExtensionRuntimeValueType {
  if (type.startsWith("entity:")) return { kind: "entity", entityId: type };
  if (type.startsWith("enum:")) return { kind: "enum", enumId: type };
  const money = moneyProfileFromType(type);
  if (money) return { kind: "money", ...money };
  if (["String", "Int", "Decimal", "Boolean", "UUID", "DateTime"].includes(type)) {
    return { kind: "scalar", name: type };
  }
  throw new Error(`E6802 Unsupported extension tool type '${type}'.`);
}

function valueSchema(ir: ModelIR, type: string): JsonSchema {
  if (type.startsWith("entity:")) return { type: "string", format: "uuid" };
  if (type.startsWith("enum:")) {
    const enumeration = ir.enums.find((candidate) => candidate.id === type);
    if (!enumeration) throw new Error(`E6803 Unknown extension tool enum '${type}'.`);
    return { type: "string", enum: enumeration.members.map((member) => member.naming.typescriptValue) };
  }
  const money = moneyProfileFromType(type);
  if (money) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["currency", "amount"],
      properties: {
        currency: { const: money.currency },
        amount: {
          type: "string",
          pattern: `^-?(0|[1-9][0-9]*)(?:\\.[0-9]{1,${money.scale}})?$`,
        },
      },
    };
  }
  return ({
    String: { type: "string" },
    Int: { type: "integer" },
    Decimal: { type: "string", pattern: "^-?(0|[1-9][0-9]*)(?:\\.[0-9]+)?$" },
    Boolean: { type: "boolean" },
    UUID: { type: "string", format: "uuid" },
    DateTime: { type: "string", format: "date-time" },
  } satisfies Record<string, JsonSchema>)[type] ?? (() => { throw new Error(`E6802 Unsupported extension tool type '${type}'.`); })();
}

function optional(schema: JsonSchema, isOptional: boolean): JsonSchema {
  return isOptional ? { anyOf: [schema, { type: "null" }] } : schema;
}

function contractRevision(extension: IRExtension): string {
  const contract = {
    id: extension.id,
    contract: {
      parameters: extension.contract.parameters.map((parameter) => ({
        id: parameter.id,
        name: parameter.name,
        type: parameter.type,
        optional: parameter.optional,
      })),
      result: {
        type: extension.contract.result.type,
        optional: extension.contract.result.optional,
      },
    },
    implementation: extension.implementation,
    effects: extension.effects,
    reliability: extension.reliability,
    authorization: extension.authorization,
    testObligations: extension.testObligations,
  };
  return `sha256:${createHash("sha256").update(stableJson(contract), "utf8").digest("hex")}`;
}

function outputSchema(ir: ModelIR, extension: IRExtension, revision: string): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: [
      "$schema", "extensionToolResultVersion", "catalogVersion", "model", "extensionId",
      "contractRevision", "kind", "authority", "execution", "result",
    ],
    properties: {
      $schema: { const: "https://modellang.dev/schemas/extension-tool-result.schema.json" },
      extensionToolResultVersion: { const: 1 },
      catalogVersion: { const: 7 },
      model: { const: { id: ir.model.id, name: ir.model.name, version: ir.model.version, sourceHash: ir.model.sourceHash } },
      extensionId: { const: extension.id },
      contractRevision: { const: revision },
      kind: { const: "hostExtensionResult" },
      authority: { const: "none" },
      execution: {
        const: {
          implementation: "hostProvided",
          generatedImplementation: false,
          authorization: "hostEnforced",
          contractConformance: "hostAsserted",
          evidence: "hostOwned",
        },
      },
      result: optional(valueSchema(ir, extension.contract.result.type), extension.contract.result.optional),
    },
  };
}

export function generateAgentExtensionTools(ir: ModelIR): AgentExtensionTool[] {
  return ir.extensions.map((extension) => {
    const revision = contractRevision(extension);
    const inputProperties = Object.fromEntries(extension.contract.parameters.map((parameter) => [
      parameter.name,
      optional(valueSchema(ir, parameter.type), parameter.optional),
    ]));
    const writes = extension.effects.writeEntityIds.length > 0;
    const emits = extension.effects.emittedEventIds.length > 0;
    const external = extension.effects.externalSystems.length > 0;
    return {
      id: extension.id,
      name: extension.name,
      description: `Invoke the host-provided ${extension.name} extension contract. The implementation, authorization, tests, and effects remain host responsibilities.`,
      kind: "extension",
      contractVersion: 1,
      contractRevision: revision,
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        required: extension.contract.parameters.filter((parameter) => !parameter.optional).map((parameter) => parameter.name),
        properties: inputProperties,
      },
      outputSchema: outputSchema(ir, extension, revision),
      input: extension.contract.parameters.map((parameter) => ({
        name: parameter.name,
        type: runtimeType(parameter.type),
        optional: parameter.optional,
      })),
      result: {
        type: runtimeType(extension.contract.result.type),
        optional: extension.contract.result.optional,
      },
      execution: {
        protocol: "http",
        method: "POST",
        path: extensionToolRoute(extension.id),
        authenticated: true,
        implementation: "hostAdapterRequired",
        generatedImplementation: false,
        runtimeAuthorizationRequired: true,
      },
      authorization: {
        enforcement: "hostRequired",
        declaredContext: extension.authorization,
        callerInput: false,
      },
      effects: {
        readsModelState: extension.effects.readEntityIds.length > 0,
        writesModelState: writes,
        callsExternalSystems: external,
        emitsEvents: emits,
      },
      reliability: { ...extension.reliability },
      annotations: {
        readOnly: !writes && !emits && !external,
        destructive: writes,
        idempotent: extension.reliability.idempotent,
        openWorld: true,
      },
      conformance: {
        implementationVerification: "hostResponsibility",
        testVerification: "hostResponsibility",
        discoveryGrantsAuthority: false,
        resultGrantsAuthority: false,
      },
    };
  });
}
