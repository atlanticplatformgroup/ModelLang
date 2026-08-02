# ModelLang 0.31 unstable boundaries

The following remain outside the stable read contract: collection or reverse traversal, projection cycles, inferred joins, runtime-selected paths or depth, aliases, computed fields, inline anonymous shapes, nested authorization, conditional disclosure, optional filters, caller-controlled sorting or limits, cursor or offset pagination, aggregates, grouping, full-text search, freshness, caching, field-level capability negotiation, MCP-specific result contracts, and generic CRUD.

A nested projection grants no authority. It does not perform a second authorization decision or row query, and it must not be interpreted as permission to enumerate the referenced entity independently.

The stable 0.31 guarantee is an acyclic compile-time-fixed graph of closed to-one shapes with explicit null propagation, transitive dependency closure, exact target identity, deterministic direct JSON construction, and consistent contracts across PostgreSQL, IR, manifests, OpenAPI, HTTP, TypeScript, UI, evolution, and engineering evidence.
