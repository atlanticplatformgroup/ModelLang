# ModelLang 0.45 extension-backed agent tool adapters

## Scope

Catalog v7 publishes each declared external extension in a separate `extensionTools` collection. MCP adapter v5 exposes the same bindings as tools under stable extension-ID suffixes, and generated HTTP clients and servers expose one authenticated `POST /agent/extensions/{stable-extension-id}` route per binding. Core action/query tools and extension tools remain distinct.

Each binding contains the stable extension identity, authored name, exact closed JSON Schema 2020-12 input and result-envelope schemas, an opaque semantic contract revision, declared authorization context, coarse effect/reliability metadata, conservative MCP annotations, and an explicit host-responsibility statement. It does not publish implementation location, owner, test paths, source spans, expressions, SQL, credentials, or external service identity.

## Host adapter contract

The host binds an extension adapter to each authenticated request context. Before invocation the generated boundary:

1. validates the closed input without accepting caller identity;
2. requires the adapter to affirm support for the exact stable extension ID and opaque contract revision;
3. requires the adapter to authorize the exact validated input for the authenticated context;
4. invokes the adapter with a fresh invocation ID plus declared authorization and retry metadata;
5. validates the host result against the declared type; and
6. wraps it in extension tool result v1.

Missing registration or a revision mismatch fails closed as unavailable. Host denial fails as unauthorized. Invalid host output fails closed without returning the invalid value. Caller command metadata and delegated capability credentials are rejected because their semantics belong to core ModelLang actions, not external extension tools.

The host owns implementation correctness, downstream authentication and authorization, service identity, side effects, idempotency, retry scheduling, evidence, test execution, deployment, monitoring, and contract-revision registration. `supports` is a host assertion, not compiler verification.

## Result, caching, and authority

Extension tool result v1 is an object envelope containing model and extension identity, exact contract revision, `authority: "none"`, host-implementation and host-evidence markers, and the schema-valid result. HTTP and MCP responses use no-store metadata. No current-state freshness claim is made: an extension result is executable tool output, not a query-backed current-state resource, and MCP returns no embedded resource for it.

Catalog discovery, MCP discovery, adapter registration, authorization success, and returned data do not grant ModelLang action or delegated authority. Later core action execution still authenticates and re-enforces all current ModelLang rules. The adapter does not make the private extension ledger executable, prove declared effects, satisfy host test obligations, or close the target's external implementation gap.
