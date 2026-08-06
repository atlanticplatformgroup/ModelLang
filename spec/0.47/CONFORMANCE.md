# ModelLang 0.47 conformance

A conforming implementation:

1. implements the complete ModelLang 0.46 language and conformance requirements;
2. changes no source grammar, canonical IR, authority surface, domain operation, or current-state freshness contract for discovery caching;
3. emits schema-valid MCP adapter v6 with an exact deterministic SHA-256 static-discovery revision and the fixed cacheable method set `server/discover` and `tools/list`;
4. exposes a deployment-time discovery TTL in MCP milliseconds, defaults it to zero, accepts every non-negative safe integer, and rejects negative, fractional, non-finite, or unsafe values at handler creation;
5. keeps discovery cache scope private and emits the same TTL and scope through MCP result cache hints;
6. emits the discovery revision as a strong `ETag` and varies successful discovery responses on authorization, MCP protocol version, method, and name;
7. applies positive HTTP cache lifetime only to successful static discovery and retains `no-store` for zero-TTL discovery, authentication challenges, protocol errors, tool execution, current-state resources, task packets, applicability traces, delegated invocation, and extension results;
8. authenticates every request and re-enforces runtime authorization and policy regardless of cached discovery;
9. treats discovery, its revision, and all cache metadata as non-authoritative and claims neither subject applicability nor delegated authority from them; and
10. emits compiler/examples 0.47.0, MCP adapter v6, and generator profile `postgresql-http-ui-mcp-discovery-cache/31` while retaining canonical IR1, catalog v7, target profile v9 and target `/9`, and every existing runtime envelope and assurance format version.
