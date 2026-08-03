import type { IRExtension, ModelIR } from "./ir.js";
import { MODELLANG_COMPILER_VERSION } from "./version.js";

export interface ExtensionLedger {
  $schema: "https://modellang.dev/schemas/extension-ledger.schema.json";
  ledgerVersion: 1;
  compilerVersion: string;
  irVersion: 26;
  audience: "engineering";
  public: false;
  executable: false;
  model: { id: string; version: string; sourceHash: string };
  extensions: IRExtension[];
  summary: {
    declared: number;
    externallyImplemented: number;
    generatedImplementations: 0;
  };
}

export function generateExtensionLedger(ir: ModelIR): ExtensionLedger {
  return {
    $schema: "https://modellang.dev/schemas/extension-ledger.schema.json",
    ledgerVersion: 1,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    irVersion: ir.irVersion,
    audience: "engineering",
    public: false,
    executable: false,
    model: { id: ir.model.id, version: ir.model.version, sourceHash: ir.model.sourceHash },
    extensions: ir.extensions,
    summary: {
      declared: ir.extensions.length,
      externallyImplemented: ir.extensions.length,
      generatedImplementations: 0,
    },
  };
}
