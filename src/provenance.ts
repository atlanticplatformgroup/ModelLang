import { createHash } from "node:crypto";
import type { ModelIR } from "./ir.js";
import {
  MODELLANG_COMPILER_VERSION,
  MODELLANG_GENERATOR_PROFILE,
} from "./version.js";

export interface ArtifactProvenance {
  $schema: "https://modellang.dev/schemas/artifact-provenance.schema.json";
  provenanceVersion: 1;
  compilerVersion: string;
  generatorProfile: string;
  model: {
    id: string;
    name: string;
    version: string;
    sourceHash: string;
  };
  irVersion: 18;
  artifacts: {
    path: string;
    role: "canonical" | "contract" | "projection" | "assurance";
    sha256: string;
  }[];
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function artifactRole(path: string): ArtifactProvenance["artifacts"][number]["role"] {
  if (path === "model.ir.json") return "canonical";
  if (["operations.json", "decisions.json", "capabilities.json", "ui.json", "semantic.json", "events.json", "openapi.json"].includes(path)) return "contract";
  if (path === "enforcement.json" || path === "enforcement.md") return "assurance";
  return "projection";
}

export function generateArtifactProvenance(
  ir: ModelIR,
  files: Readonly<Record<string, string>>,
): ArtifactProvenance {
  return {
    $schema: "https://modellang.dev/schemas/artifact-provenance.schema.json",
    provenanceVersion: 1,
    compilerVersion: MODELLANG_COMPILER_VERSION,
    generatorProfile: MODELLANG_GENERATOR_PROFILE,
    model: {
      id: ir.model.id,
      name: ir.model.name,
      version: ir.model.version,
      sourceHash: ir.model.sourceHash,
    },
    irVersion: ir.irVersion,
    artifacts: Object.entries(files)
      .map(([path, content]) => ({ path, role: artifactRole(path), sha256: sha256(content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}
