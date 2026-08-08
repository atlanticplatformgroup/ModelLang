import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

interface PackResult {
  filename: string;
  name: string;
  version: string;
  files: { path: string }[];
}

function parsePackResult(stdout: string): PackResult {
  const jsonStart = stdout.indexOf("[");
  if (jsonStart < 0) throw new Error("npm pack did not return JSON metadata");
  const value = JSON.parse(stdout.slice(jsonStart)) as PackResult[];
  if (value.length !== 1 || !value[0]) throw new Error("npm pack did not return exactly one package");
  return value[0];
}

async function main(): Promise<void> {
  const repository = resolve(".");
  const temporary = await mkdtemp(join(tmpdir(), "modellang-package-check-"));
  try {
    const packDirectory = join(temporary, "pack");
    const consumer = join(temporary, "consumer");
    await Promise.all([mkdir(packDirectory), mkdir(consumer)]);
    const packed = await execute("npm", ["pack", "--json", "--pack-destination", packDirectory], {
      cwd: repository,
      env: { ...process.env, npm_config_loglevel: "silent" },
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = parsePackResult(packed.stdout);
    if (result.name !== "modellang" || result.version !== "0.50.0") {
      throw new Error(`Unexpected package identity ${result.name}@${result.version}`);
    }
    const paths = new Set(result.files.map((file) => file.path));
    for (const required of [
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "docs/HOST_BOOTSTRAP.md",
      "dist/src/cli.js",
      "dist/src/compiler.js",
      "dist/src/build.js",
      "schemas/model-ir.schema.json",
      "schemas/agent-plugins/1.0.0/plugin.schema.json",
      "schemas/agent-plugins/1.0.0/mcp.schema.json",
    ]) {
      if (!paths.has(required)) throw new Error(`Packed artifact is missing ${required}`);
    }
    const forbidden = [...paths].filter((path) =>
      path.startsWith("tests/")
      || path.startsWith("scripts/")
      || path.startsWith("generated/")
      || path.startsWith("examples/")
      || (path.startsWith("docs/") && path !== "docs/HOST_BOOTSTRAP.md")
      || path.startsWith("spec/")
      || path.endsWith(".DS_Store"));
    if (forbidden.length > 0) throw new Error(`Packed artifact contains development-only files: ${forbidden.join(", ")}`);

    const tarball = join(packDirectory, result.filename);
    await execute("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: consumer,
      env: { ...process.env, npm_config_loglevel: "silent" },
      maxBuffer: 10 * 1024 * 1024,
    });
    const installedPackage = JSON.parse(await readFile(join(consumer, "node_modules/modellang/package.json"), "utf8")) as {
      name: string;
      version: string;
      private?: boolean;
      license?: string;
    };
    if (installedPackage.name !== "modellang" || installedPackage.version !== "0.50.0"
      || installedPackage.private === true || installedPackage.license !== "Apache-2.0") {
      throw new Error("Installed package metadata does not match the public preview contract");
    }

    const source = await readFile(join(repository, "examples/procurement.model"), "utf8");
    const sourceFile = join(consumer, "procurement.model");
    const output = join(consumer, "generated");
    await writeFile(sourceFile, source, "utf8");
    const cli = join(consumer, "node_modules/.bin/modelc");
    const help = await execute(cli, ["--help"], { cwd: consumer });
    if (!help.stdout.includes("Usage:") || !help.stdout.includes("modelc build <file>")) {
      throw new Error("Installed modelc --help did not expose the CLI usage contract");
    }
    const checked = await execute(cli, ["check", sourceFile], { cwd: consumer });
    if (!checked.stdout.includes("OK Procurement 0.49.0")) throw new Error("Installed modelc check did not compile the preview model");
    const atomicSourceFile = join(consumer, "atomic.model");
    await writeFile(atomicSourceFile, `model Atomic version "0.50.0";
entity User { id: UUID @id @generated(uuid); }
entity Request { id: UUID @id @generated(uuid); approved: Boolean; }
entity Result { id: UUID @id @generated(uuid); request: Request @unique; actor: User; }
action approve(caller actor: User, request: Request) -> Result {
  authorize true;
  require pending: request.approved == false;
  update request { approved = true; }
  create Result { request = request; actor = actor; }
}
`, "utf8");
    await execute(cli, ["build", atomicSourceFile, "--out", join(consumer, "generated-atomic")], { cwd: consumer });
    await execute(cli, [
      "build", sourceFile, "--out", output,
      "--agent-plugin-url", "https://preview.example.com/mcp",
    ], { cwd: consumer, maxBuffer: 10 * 1024 * 1024 });
    const plugin = JSON.parse(await readFile(join(output, "agent-plugin/mcp.json"), "utf8")) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    if (plugin.mcpServers["modellang.procurement"]?.url !== "https://preview.example.com/mcp") {
      throw new Error("Installed modelc did not generate the Agent Plugin connection contract");
    }
    process.stdout.write(`OK ${result.name}@${result.version} (${paths.size} packed files; clean install, single- and multi-effect builds, and Agent Plugin generation)\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
