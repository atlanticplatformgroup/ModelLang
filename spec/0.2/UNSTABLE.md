# ModelLang 0.2 unstable boundaries

The following areas are intentionally not stable and must not be inferred from current syntax:

- collections, cardinality, and general queries;
- read authorization and filtered views;
- conditional or status-scoped temporal exclusions;
- delete semantics, ownership, and cascading behavior;
- schema migration planning and backward compatibility;
- modules and imports;
- HTTP API and production identity adapters;
- frontend forms, tables, routing, and UI annotations;
- role sets and permission relations;
- storage targets other than PostgreSQL;
- AI, MCP, agent, and prompt generators.

New syntax in these areas requires explicit semantics, typed IR representation, enforcement lowering, explanation output, and conformance tests.
