# ModelLang 0.30 unstable boundaries

The following remain outside the stable projection contract: output aliases, computed fields, relationship traversal, nested projections, collection projection, inline anonymous shapes, query unions, singular query cardinality, pagination syntax, aggregate/grouping syntax, projection-local authorization, freshness, caching, field-level capability negotiation, conditional disclosure, runtime-selected fields, MCP-specific result contracts, and generic CRUD.

Projection reuse grants no authority. It does not combine, inherit, weaken, or replace query authorization or row policy. Projection presence in IR or an engineering manifest is not a public capability and does not imply that any query can return its rows.

The stable guarantee is a named, closed, direct-field allowlist with independent semantic identity, exact encoding parity, and deterministic derivation across PostgreSQL, manifests, OpenAPI, HTTP, TypeScript, UI, evolution, and enforcement artifacts.
