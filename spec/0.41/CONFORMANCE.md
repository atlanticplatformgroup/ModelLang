# ModelLang 0.41 conformance

A conforming implementation:

1. implements the complete ModelLang 0.40 language and conformance requirements;
2. emits deterministic, schema-valid MCP adapter manifest v1 and a server adapter for MCP revision `2026-07-28`;
3. registers every catalog v3 action and query exactly once using the stable MCP-compatible ID suffix, full typed operation identity, and exact catalog input/output schemas;
4. authenticates every protocol HTTP request, binds an executor to verified bearer-token context, validates token expiry and exact resource audience, and never accepts caller identity as tool input;
5. treats discovery as static non-authoritative metadata and re-enforces all current runtime authorization, policy, validation, concurrency, reliability, disclosure, pagination, and evidence rules on every invocation;
6. accepts action execution controls only through the declared namespaced request metadata, enforces required idempotency, and rejects command metadata on queries;
7. returns action results as tool results without creating resources;
8. returns each successful query's exact structured result plus a distinct embedded resource envelope v1 with input-hiding URI, `authority: "none"`, point-in-time retrieval, zero reusable lifetime, revalidation before reuse, and no-store metadata;
9. publishes neither bearer tokens, authenticated identity, callable input, private evidence, runtime internals, nor external extensions through MCP results;
10. makes no claim of resource templates, subscriptions, prompts, tasks, delegated capabilities, task packets, public decision traces, extension-backed tools, or SML-Agent conformance;
11. emits compiler/examples 0.41.0, canonical IR1, MCP adapter manifest v1, target profile v5, target `target:postgresql-http-ui-mcp/5`, and generator profile `/25`, while retaining catalog v3, resource envelope v1, operation manifest v11, and capability manifest v10.
