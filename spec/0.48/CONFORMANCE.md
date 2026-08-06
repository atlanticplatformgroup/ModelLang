# ModelLang 0.48 conformance

A conforming implementation:

1. implements the complete ModelLang 0.47 language and conformance requirements;
2. changes no source grammar, canonical IR, authority surface, domain operation, MCP runtime, or freshness contract for Agent Plugin packaging;
3. emits no Agent Plugin package unless a deployment endpoint is explicitly supplied;
4. places a schema-valid Agent Plugins 1.0.0 `plugin.json` and `mcp.json` under an isolated `agent-plugin/` package root without replacing the ModelLang adapter manifest;
5. emits exactly one `streamable-http` server entry bound to the supplied absolute endpoint, rejects user information and fragments, and requires HTTPS outside loopback;
6. validates explicit names against the Agent Plugins 1.0.0 closed naming contract and deterministically derives a valid default from the model name;
7. emits no credentials, authentication headers, OAuth claims, stdio launcher, SSE fallback, Agent Skill, or client extension;
8. treats package discovery and client installation as non-authoritative and authenticates and re-enforces every runtime operation through the existing ModelLang contracts;
9. pins the official Agent Plugins 1.0.0 schemas for deterministic generated-document tests and records emitted package documents as provenance contracts; and
10. emits compiler/examples 0.48.0 and generator profile `postgresql-http-ui-agent-plugin/32` while retaining canonical IR1, MCP adapter v6, catalog v7, target profile v9 and target `/9`, and every existing runtime envelope and assurance format version.
