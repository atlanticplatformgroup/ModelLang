import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { generateAgentPluginPackage } from "../src/agent-plugin.js";
import { generateAll } from "../src/build.js";
import { compileText } from "../src/compiler.js";

async function procurement() {
  return compileText(await readFile("examples/procurement.model", "utf8"), "examples/procurement.model");
}

describe("Agent Plugins packaging", () => {
  it("emits a schema-valid portable package around a deployed Streamable HTTP endpoint", async () => {
    const output = generateAgentPluginPackage(await procurement(), {
      endpointUrl: "https://procurement.example.com/mcp",
    });
    const plugin = JSON.parse(output["agent-plugin/plugin.json"]!);
    const mcp = JSON.parse(output["agent-plugin/mcp.json"]!);
    const pluginSchema = JSON.parse(await readFile("schemas/agent-plugins/1.0.0/plugin.schema.json", "utf8"));
    const mcpSchema = JSON.parse(await readFile("schemas/agent-plugins/1.0.0/mcp.schema.json", "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validatePlugin = ajv.compile(pluginSchema);
    const validateMcp = ajv.compile(mcpSchema);

    expect(validatePlugin(plugin), JSON.stringify(validatePlugin.errors)).toBe(true);
    expect(validateMcp(mcp), JSON.stringify(validateMcp.errors)).toBe(true);
    expect(plugin).toMatchObject({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "modellang.procurement",
      version: "0.48.0",
    });
    expect(mcp).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "modellang.procurement": {
          type: "streamable-http",
          url: "https://procurement.example.com/mcp",
        },
      },
    });
    expect(JSON.stringify(mcp)).not.toMatch(/authorization|bearer|token|secret|headers/i);
  });

  it("keeps deployment packaging optional and includes it in provenance only when requested", async () => {
    const ir = await procurement();
    const compilerOnly = generateAll(ir);
    expect(compilerOnly).not.toHaveProperty("agent-plugin/plugin.json");
    expect(compilerOnly).not.toHaveProperty("agent-plugin/mcp.json");

    const packaged = generateAll(ir, {
      agentPlugin: { endpointUrl: "http://127.0.0.1:3000/mcp", pluginName: "acme.procurement" },
    });
    expect(JSON.parse(packaged["agent-plugin/plugin.json"]!)).toMatchObject({ name: "acme.procurement" });
    expect(JSON.parse(packaged["agent-plugin/mcp.json"]!).mcpServers["acme.procurement"].url)
      .toBe("http://127.0.0.1:3000/mcp");
    const provenance = JSON.parse(packaged["provenance.json"]!) as { artifacts: { path: string; role: string }[] };
    expect(provenance.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "agent-plugin/plugin.json", role: "contract" }),
      expect.objectContaining({ path: "agent-plugin/mcp.json", role: "contract" }),
    ]));
  });

  it("rejects unsafe remote endpoints and invalid package names before writing files", async () => {
    const ir = await procurement();
    expect(() => generateAgentPluginPackage(ir, { endpointUrl: "http://example.com/mcp" }))
      .toThrow(/outside loopback must use HTTPS/);
    expect(() => generateAgentPluginPackage(ir, { endpointUrl: "https://user:secret@example.com/mcp" }))
      .toThrow(/must not contain user information/);
    expect(() => generateAgentPluginPackage(ir, { endpointUrl: "https://example.com/mcp#secret" }))
      .toThrow(/must not contain a fragment/);
    expect(() => generateAgentPluginPackage(ir, {
      endpointUrl: "https://example.com/mcp",
      pluginName: "Invalid--Name",
    })).toThrow(/Agent Plugin name must/);
  });
});
