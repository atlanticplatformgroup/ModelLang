# ModelLang 0.47 language

ModelLang 0.47 consists of the complete [ModelLang 0.46 language](../0.46/LANGUAGE.md) plus [revision-bound MCP discovery caching](./MCP_DISCOVERY_CACHE.md). It adds no source-language grammar, canonical IR field, authority surface, domain operation, or current-state freshness option and retains canonical IR1.

The generated MCP handler accepts a deployment-time `discoveryCacheTtlMs` option for the static `server/discover` and `tools/list` results. The default remains zero. The value is a non-negative safe integer in the MCP protocol's millisecond unit; ModelLang imposes no smaller arbitrary maximum. Discovery cache scope remains private because the endpoint is authenticated.

Every generated MCP manifest carries a deterministic SHA-256 discovery revision over the exact compiler, adapter, catalog, task-packet, and public-trace discovery contract. Successful static discovery responses expose that revision as a strong `ETag`, vary on authorization and MCP routing/version headers, and use response-kind-specific HTTP cache control. All other MCP responses remain `Cache-Control: no-store`.

Version 0.47 advances compiler and examples to 0.47.0, MCP adapter to v6, and generator profile to `postgresql-http-ui-mcp-discovery-cache/31`. Canonical IR1, catalog v7, target profile v9 and target `target:postgresql-http-ui-extension-tools/9`, SML-Agent assessment v1, evaluation suite/replay v1, extension tool result v1, extension ledger v1, public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.
