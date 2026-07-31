# ModelLang 0.11 operation-transport conformance

The 0.11 implementation is conformant when:

1. All 0.10 language, enforcement, migration, and golden-artifact tests continue to pass.
2. Source grammar and canonical IR remain unchanged at IR version 9.
3. A deterministic manifest v1 is generated exclusively from canonical IR.
4. The manifest contains no PostgreSQL or HTTP representation details.
5. Every declared action and query appears once by stable semantic ID.
6. Callable input excludes the caller parameter and generated HTTP schemas reject caller-shaped or other unknown properties.
7. HTTP routes derive from stable IDs, so operation renames do not change routes.
8. OpenAPI 3.1.1 describes bearer authentication, closed JSON inputs, typed results, and RFC 9457 problem responses.
9. The browser-safe TypeScript entry point has no database adapter, SQL, Node.js, or PostgreSQL dependency.
10. The server authenticates before operation execution and passes only validated callable input to a caller-bound executor.
11. Executor results are validated against manifest entity shapes, nullability, and query bounds before serialization.
12. Typed ModelLang errors survive a server-to-browser HTTP round trip without exposing raw unexpected backend failures.
13. The Procurement integration proves authenticated action, workflow, query isolation, caller-spoofing rejection, and typed failure behavior over a real HTTP and PostgreSQL path.
