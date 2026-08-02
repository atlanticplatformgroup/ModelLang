# ModelLang 0.32 unstable boundaries

The following remain outside the stable read contract: offset or page-number pagination, caller-controlled page size, runtime-selected sorting, cursor signing or encryption, frozen cross-request snapshots, collection or reverse traversal, inferred joins, runtime-selected projection paths or depth, aliases, computed fields, inline anonymous shapes, nested authorization, conditional disclosure, optional filters, aggregates, grouping, full-text search, caching, field-level capability negotiation, MCP-specific result contracts, and generic CRUD.

A cursor grants no authority and carries no trusted current state. It is an opaque deterministic continuation bound to the current compiled query, caller, filters, and last key. Each page remains a new authenticated and policy-filtered read under its own database statement snapshot.
