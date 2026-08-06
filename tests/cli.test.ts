import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("modelc deployment packaging", () => {
  it("prints help successfully without requiring a model file", async () => {
    const result = await execute(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], {
      cwd: resolve("."),
    });
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("modelc build <file>");
    expect(result.stderr).toBe("");
  });

  it("writes an installable Agent Plugin package only when the build supplies an endpoint", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "modellang-agent-plugin-"));
    const output = join(temporary, "procurement");
    try {
      const result = await execute(process.execPath, [
        "--import", "tsx", "src/cli.ts", "build", "examples/procurement.model",
        "--out", output,
        "--agent-plugin-url", "https://public.example.com/mcp",
        "--agent-plugin-name", "example.procurement",
      ], { cwd: resolve(".") });
      expect(result.stdout).toContain("with Agent Plugin package");
      expect(JSON.parse(await readFile(join(output, "agent-plugin/plugin.json"), "utf8")))
        .toMatchObject({ name: "example.procurement", version: "0.49.0" });
      expect(JSON.parse(await readFile(join(output, "agent-plugin/mcp.json"), "utf8")))
        .toEqual({
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: {
            "example.procurement": { type: "streamable-http", url: "https://public.example.com/mcp" },
          },
        });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
