# ModelLang 0.48 Agent Plugin packaging contract

## Package boundary

Agent Plugins is a distribution package format above MCP. It does not replace the generated MCP server, adapter manifest, transport lifecycle, authentication, or runtime authorization.

When deployment packaging is requested, `<output>/agent-plugin/` is the plugin root. It contains:

- `plugin.json`, the Agent Plugins portable manifest; and
- `mcp.json`, the Agent Plugins MCP connection configuration.

The existing `<output>/mcp.json` remains the ModelLang MCP adapter manifest. The two documents have different schemas and meanings and MUST NOT overwrite or substitute for one another.

## Deployment input

The endpoint is deployment data and MUST NOT enter ModelLang source or canonical IR1. The generator accepts it only as a build option. It MUST be an absolute HTTP or HTTPS URL without user information or a fragment. A non-loopback endpoint MUST use HTTPS. Loopback HTTP is permitted for local harnesses.

The optional package name MUST satisfy Agent Plugins 1.0.0 naming constraints. If omitted, the generator deterministically derives `modellang.<normalized-model-name>`. The package version is the source model version.

## Portable documents

Generated `plugin.json` declares `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, the package name and version, a bounded description, and static discovery keywords.

Generated `mcp.json` declares `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and exactly one named `streamable-http` server whose URL is the validated deployment endpoint. The generator emits no headers, environment variables, placeholder credentials, OAuth configuration, stdio command, or SSE fallback.

The repository pins local copies of both official schemas for deterministic validation. Generated documents retain the canonical external schema identifiers. The Agent Plugins normative specification remains authoritative over its schemas.

## Security and authority

The package is visible distribution metadata. It MUST NOT contain a bearer token, API key, cookie, password, client secret, user information, or other credential. The caller MUST treat the complete supplied endpoint URL as public package data and MUST NOT put a secret in its path or query. Authentication setup remains client-managed because Agent Plugins 1.0.0 defines no portable credential-reference or OAuth fields.

Discovering, installing, enabling, or connecting through the package grants no authority and proves neither current applicability nor successful execution. Every MCP request independently authenticates and every tool/resource operation reuses the existing ModelLang authorization, row policy, disclosure, bounds, freshness, delegation, and extension contracts.

## Optional generation and provenance

Without deployment packaging options, no `agent-plugin/` paths are emitted. With them, both portable documents participate in deterministic artifact provenance as contracts. Their hashes therefore bind the selected public endpoint and package identity without changing the model source hash, canonical IR, ModelLang MCP adapter output, or domain semantics for the same compiler/model input.
