import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelIR } from "./ir.js";
import { stableJson } from "./ir.js";
import { generatePostgres } from "./codegen/postgres.js";
import { generateTypeScript } from "./codegen/typescript.js";
import { generateHttp } from "./codegen/http.js";
import { generateMermaid } from "./codegen/mermaid.js";
import { enforcementJson, generateEnforcementMarkdown } from "./codegen/enforcement.js";
import { generateOperationManifest } from "./operation-manifest.js";
import { generateUiManifest } from "./ui-manifest.js";
import { generateUi } from "./codegen/ui.js";
import { generateSemanticManifest } from "./semantic-manifest.js";
import { generateArtifactProvenance } from "./provenance.js";
import { generateDecisionPlan } from "./decision-plan.js";
import { generateCapabilityManifest } from "./capability-manifest.js";
import { generateEventManifest } from "./event-manifest.js";
import { generateExtensionLedger } from "./extension-ledger.js";
import { generateTargetCapabilityReport } from "./target-capabilities.js";
import { generateAgentToolCatalog } from "./agent-tool-catalog.js";
import { generateMcp } from "./mcp.js";
import { generateTaskPacketSchemas, taskPacketActionContracts } from "./task-packet.js";
import { generateDelegatedCapabilitySchemas } from "./delegated-capability.js";
import { generatePublicDecisionTraceSchemas, publicDecisionTraceActionContracts } from "./public-decision-trace.js";
import { generateAgentExtensionTools } from "./extension-tool.js";

export interface GeneratedFiles {
  [path: string]: string;
}

export function generateAll(ir: ModelIR): GeneratedFiles {
  const operationManifest = generateOperationManifest(ir);
  const decisionPlan = generateDecisionPlan(ir);
  const capabilityManifest = generateCapabilityManifest(operationManifest, decisionPlan);
  const uiManifest = generateUiManifest(operationManifest);
  const semanticManifest = generateSemanticManifest(ir, operationManifest);
  const eventManifest = generateEventManifest(ir);
  const extensionTools = generateAgentExtensionTools(ir);
  const agentToolCatalog = generateAgentToolCatalog(operationManifest, capabilityManifest, extensionTools);
  const taskPacketSchemas = generateTaskPacketSchemas(agentToolCatalog, operationManifest);
  const delegatedCapabilitySchemas = generateDelegatedCapabilitySchemas(agentToolCatalog);
  const publicDecisionTraceSchemas = generatePublicDecisionTraceSchemas(agentToolCatalog);
  const files: GeneratedFiles = {
    "model.ir.json": stableJson(ir),
    "operations.json": stableJson(operationManifest),
    "decisions.json": stableJson(decisionPlan),
    "capabilities.json": stableJson(capabilityManifest),
    "agent-tools.json": stableJson(agentToolCatalog),
    "ui.json": stableJson(uiManifest),
    "semantic.json": stableJson(semanticManifest),
    "events.json": stableJson(eventManifest),
    "extensions.json": stableJson(generateExtensionLedger(ir)),
    "target-capabilities.json": stableJson(generateTargetCapabilityReport(ir)),
    "model.mmd": generateMermaid(ir),
    "enforcement.json": stableJson(enforcementJson(ir)),
    "enforcement.md": generateEnforcementMarkdown(ir),
  };
  Object.assign(files, generateMcp(agentToolCatalog, taskPacketSchemas, delegatedCapabilitySchemas, publicDecisionTraceSchemas));
  for (const [name, content] of Object.entries(generatePostgres(ir, decisionPlan))) files[`postgres/${name}`] = content;
  for (const [name, content] of Object.entries(generateTypeScript(ir, decisionPlan, capabilityManifest))) files[`typescript/${name}`] = content;
  Object.assign(files, generateHttp(
    operationManifest,
    capabilityManifest,
    taskPacketSchemas,
    taskPacketActionContracts(agentToolCatalog, operationManifest),
    delegatedCapabilitySchemas,
    publicDecisionTraceSchemas,
    publicDecisionTraceActionContracts(agentToolCatalog),
    extensionTools,
  ));
  Object.assign(files, generateUi(operationManifest, uiManifest));
  files["provenance.json"] = stableJson(generateArtifactProvenance(ir, files));
  return files;
}

async function writeFilesAtomically(files: GeneratedFiles, outputDirectory: string): Promise<void> {
  const output = resolve(outputDirectory);
  const parent = dirname(output);
  const temporary = join(parent, `.modellang-${randomUUID()}`);
  const backup = join(parent, `.modellang-backup-${randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  try {
    for (const [relative, content] of Object.entries(files)) {
      const path = join(temporary, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    let hadOutput = false;
    try {
      await rename(output, backup);
      hadOutput = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(temporary, output);
    } catch (error) {
      if (hadOutput) await rename(backup, output);
      throw error;
    }
    if (hadOutput) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function writeGeneratedAtomically(ir: ModelIR, outputDirectory: string): Promise<void> {
  await writeFilesAtomically(generateAll(ir), outputDirectory);
}

export async function writeGeneratedModelsAtomically(models: Readonly<Record<string, ModelIR>>, outputDirectory: string): Promise<void> {
  const files: GeneratedFiles = {};
  for (const [modelName, ir] of Object.entries(models)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(modelName)) throw new Error(`E5002 Invalid generated model directory '${modelName}'.`);
    for (const [path, content] of Object.entries(generateAll(ir))) files[`${modelName}/${path}`] = content;
  }
  await writeFilesAtomically(files, outputDirectory);
}
