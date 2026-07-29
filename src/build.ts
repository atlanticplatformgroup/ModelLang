import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelIR } from "./ir.js";
import { stableJson } from "./ir.js";
import { generatePostgres } from "./codegen/postgres.js";
import { generateTypeScript } from "./codegen/typescript.js";
import { generateMermaid } from "./codegen/mermaid.js";
import { enforcementJson, generateEnforcementMarkdown } from "./codegen/enforcement.js";

export interface GeneratedFiles {
  [path: string]: string;
}

export function generateAll(ir: ModelIR): GeneratedFiles {
  const files: GeneratedFiles = {
    "model.ir.json": stableJson(ir),
    "model.mmd": generateMermaid(ir),
    "enforcement.json": stableJson(enforcementJson(ir)),
    "enforcement.md": generateEnforcementMarkdown(ir),
  };
  for (const [name, content] of Object.entries(generatePostgres(ir))) files[`postgres/${name}`] = content;
  for (const [name, content] of Object.entries(generateTypeScript(ir))) files[`typescript/${name}`] = content;
  return files;
}

export async function writeGeneratedAtomically(ir: ModelIR, outputDirectory: string): Promise<void> {
  const output = resolve(outputDirectory);
  const parent = dirname(output);
  const temporary = join(parent, `.modellang-${randomUUID()}`);
  const backup = join(parent, `.modellang-backup-${randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  try {
    for (const [relative, content] of Object.entries(generateAll(ir))) {
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
