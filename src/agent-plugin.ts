import { createHash } from "node:crypto";
import type { ModelIR } from "./ir.js";
import { stableJson } from "./ir.js";

const AGENT_PLUGIN_MANIFEST_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_PLUGIN_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

export interface AgentPluginGenerationOptions {
  readonly endpointUrl: string;
  readonly pluginName?: string;
}

interface AgentPluginManifest {
  readonly $schema: typeof AGENT_PLUGIN_MANIFEST_SCHEMA;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly keywords: readonly string[];
}

interface AgentPluginMcpConfiguration {
  readonly $schema: typeof AGENT_PLUGIN_MCP_SCHEMA;
  readonly mcpServers: Readonly<Record<string, {
    readonly type: "streamable-http";
    readonly url: string;
  }>>;
}

const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function defaultPluginName(modelName: string): string {
  const normalized = modelName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const maxComponentLength = 64 - "modellang.".length;
  const component = normalized.length <= maxComponentLength
    ? normalized
    : `${normalized.slice(0, maxComponentLength - 9).replace(/[^a-z0-9]+$/g, "")}-${createHash("sha256").update(normalized).digest("hex").slice(0, 8)}`;
  return `modellang.${component}`;
}

function validatePluginName(name: string): string {
  if (name.length < 1 || name.length > 64 || !pluginNamePattern.test(name)) {
    throw new Error(
      "Agent Plugin name must be 1-64 lowercase alphanumeric, hyphen, or period characters, begin and end alphanumeric, and contain neither '--' nor '..'",
    );
  }
  return name;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "[::1]") return true;
  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d{1,3}$/.test(octet));
}

function validateEndpointUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agent Plugin MCP endpoint must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent Plugin MCP endpoint must be an absolute HTTP(S) URL");
  }
  if (url.username || url.password) throw new Error("Agent Plugin MCP endpoint must not contain user information");
  if (url.hash) throw new Error("Agent Plugin MCP endpoint must not contain a fragment");
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("Agent Plugin MCP endpoints outside loopback must use HTTPS");
  }
  return url.href;
}

export function generateAgentPluginPackage(
  ir: ModelIR,
  options: AgentPluginGenerationOptions,
): Readonly<Record<string, string>> {
  const name = validatePluginName(options.pluginName ?? defaultPluginName(ir.model.name));
  const endpointUrl = validateEndpointUrl(options.endpointUrl);
  const manifest: AgentPluginManifest = {
    $schema: AGENT_PLUGIN_MANIFEST_SCHEMA,
    name,
    version: ir.model.version,
    description: `Generated ModelLang application plugin for ${ir.model.name}. Runtime authentication and authorization remain authoritative.`,
    keywords: ["modellang", "mcp", "semantic-model"],
  };
  const mcp: AgentPluginMcpConfiguration = {
    $schema: AGENT_PLUGIN_MCP_SCHEMA,
    mcpServers: {
      [name]: {
        type: "streamable-http",
        url: endpointUrl,
      },
    },
  };
  return {
    "agent-plugin/plugin.json": stableJson(manifest),
    "agent-plugin/mcp.json": stableJson(mcp),
  };
}
