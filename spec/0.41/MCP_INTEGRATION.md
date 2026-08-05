# Direct MCP integration

## Generated contracts

Each model emits deterministic `mcp.json` adapter manifest v1 and a server-only TypeScript MCP handler. The handler uses Streamable HTTP at a host-selected resource-server URL, supports stateless legacy negotiation, and implements MCP revision `2026-07-28`.

Catalog v3 remains the source of tool identity and schemas. Each MCP tool name is the MCP-compatible stable-ID suffix of the full `action:` or `query:` operation ID. The full operation ID is retained as metadata and is the only ID sent to the existing operation executor. MCP input and output schemas are exact copies of the catalog JSON Schema 2020-12 documents; the adapter introduces no caller identity or command-control fields into operation input.

## Authentication and authority

The host provides bearer-token verification and returns an authenticated MCP context containing protocol `AuthInfo` and an operation executor bound to the same verified subject. Every protocol HTTP request is authenticated independently. The adapter rejects absent, expired, token-mismatched, or wrong-resource-audience authentication before protocol dispatch. It never forwards the bearer token to operation input or output.

Tool discovery is static and unfiltered. It grants no authority and does not predict current applicability. Every action and query invocation goes through the existing authoritative executor, which continues to enforce identity, authorization, row policy, preconditions, workflows, revisions, invariants, disclosure, sorting, bounds, pagination, validation, idempotency, and transactional evidence as applicable.

Command-only execution controls use namespaced MCP request `_meta`: `dev.modellang/expectedRevision`, `dev.modellang/idempotencyKey`, `dev.modellang/correlationId`, and `dev.modellang/causationId`. Required idempotency is enforced by the adapter. Query tools reject command metadata.

## Current-state resources

A successful query tool call returns the exact validated query result as `structuredContent` and a separate embedded resource with media type `application/vnd.modellang.agent-resource+json`. Its payload is resource envelope v1, unchanged from 0.40: it contains the query result but not callable input, authenticated identity, bearer token, extensions, expressions, runtime internals, or private evidence.

The embedded resource URI contains model/query identity and an opaque per-read UUID, never the input or a derivative of it. The envelope remains non-authoritative and point-in-time with `maxAgeSeconds: 0` and `revalidate: "beforeReuse"`; MCP metadata and the HTTP response declare `no-store`. A later use requires another authenticated query invocation. Action calls return no resource.

The v1 adapter does not expose MCP resource templates, `resources/read`, subscriptions, prompts, tasks, delegated authority, task packets, public decision traces, extension-backed tools, or general SML-Agent conformance.
