# ModelLang 0.47 MCP discovery cache contract

## Boundary

Only `server/discover` and `tools/list` are cacheable. They describe the static generated adapter and tool catalog. They contain neither current business state nor proof that the authenticated caller may execute any listed operation. Discovery remains unfiltered, non-authoritative metadata and every later operation independently authenticates and re-enforces current runtime rules.

Current-state query results, task packets, applicability and public decision traces, actions, delegated invocations, extension results, protocol errors, and authentication challenges are not covered by the discovery policy. Their existing zero-age or no-store contracts remain unchanged.

## Deployment option

The generated handler option `discoveryCacheTtlMs` selects the MCP `ttlMs` emitted for static discovery. It defaults to `0`, uses milliseconds, and must be a non-negative JavaScript safe integer. Invalid values fail synchronously when the handler is created. ModelLang sets `cacheScope: "private"` and does not add a product-specific maximum; the deploying developer selects the lifetime appropriate to the release process.

At zero milliseconds, discovery responses retain `Cache-Control: no-store`. At a positive value, successful discovery responses use `Cache-Control: private, max-age=<floor(ttlMs / 1000)>`; a positive subsecond value additionally requires revalidation at the HTTP layer. MCP's exact millisecond hint remains authoritative for MCP clients.

## Revision and variation

The compiler deterministically hashes the complete static discovery contract, including compiler and adapter versions, the exact catalog, task-packet schemas, and public-trace schemas. The resulting `sha256:` revision is recorded in `mcp.json` and returned as a strong `ETag` on successful discovery responses.

Responses vary on `Authorization`, `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`. The revision identifies a representation but does not provide push invalidation: a client may reuse a discovery result only for its configured TTL, then must request it again. A cached revision grants no authority and cannot suppress authentication or runtime authorization for an operation.
