# ModelLang 0.41 language

ModelLang 0.41 consists of the complete [ModelLang 0.40 language](../0.40/LANGUAGE.md) plus [direct MCP adapter integration](./MCP_INTEGRATION.md). It adds no source-language grammar and retains canonical IR1.

Every catalog v3 action and query is exposed as an MCP tool using its stable authored-operation suffix and the catalog's exact closed input and output schemas. Query tool results additionally carry a distinct embedded current-state resource envelope; action results do not become resources.

Version 0.41 adds MCP adapter manifest v1 and target capability `agents.mcpAdapter`. It advances target capability profile to v5, target `target:postgresql-http-ui-mcp/5`, and generator profile `postgresql-http-ui-mcp/25`; agent catalog v3, resource envelope v1, operation manifest v11, capability manifest v10, and subject capability view v1 remain unchanged.
