import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("assigns nested projection IDs through the CLI, checks the result, and is idempotent", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "modellang-assign-nested-"));
    const model = join(temporary, "nested.model");
    const source = `model NestedProjectionIds version "1";
entity A { id: UUID @id; }
entity B { id: UUID @id; a: A; }
projection ASummary from A { id; }
projection BSummary from B { a: ASummary; }
query bs(caller actor: A) returns BSummary from B as b {
  authorize true;
  where true;
  orderBy b.id asc;
  limit 10;
}
`;
    try {
      await writeFile(model, source, "utf8");
      const first = await execute(process.execPath, ["--import", "tsx", "src/cli.ts", "assign-ids", model], { cwd: resolve(".") });
      expect(first.stdout).toMatch(/Assigned \d+ stable IDs/);
      const assigned = await readFile(model, "utf8");
      const nested = /a: ASummary @stableId\("(pfd_[0-9a-f]{32})"\);/.exec(assigned);
      expect(nested).not.toBeNull();
      expect(assigned).not.toMatch(/a @stableId\("pfd_[0-9a-f]{32}"\): ASummary/);
      expect(assigned).toMatch(/projection ASummary[^}]+\{ id @stableId\("pfd_[0-9a-f]{32}"\); \}/);

      const checked = await execute(process.execPath, ["--import", "tsx", "src/cli.ts", "check", model], { cwd: resolve(".") });
      expect(checked.stdout).toContain("OK NestedProjectionIds 1");
      const printed = await execute(process.execPath, ["--import", "tsx", "src/cli.ts", "print-ir", model], { cwd: resolve(".") });
      const ir = JSON.parse(printed.stdout) as { projections: { name: string; fields: { id: string; name: string }[] }[] };
      expect(ir.projections.find((projection) => projection.name === "BSummary")?.fields)
        .toContainEqual(expect.objectContaining({ id: `projectionField:${nested![1]}`, name: "a" }));

      const second = await execute(process.execPath, ["--import", "tsx", "src/cli.ts", "assign-ids", model], { cwd: resolve(".") });
      expect(second.stdout).toContain("All stable IDs already assigned");
      expect(await readFile(model, "utf8")).toBe(assigned);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
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
