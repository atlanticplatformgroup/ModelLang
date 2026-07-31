# ModelLang 0.12 unstable gateway boundaries

The following remain undefined or host-owned:

- token formats, verification libraries, trusted issuers, audiences, algorithms, key rotation, revocation, refresh, and session lifecycle;
- cookie authentication, CSRF protection, browser credential modes, and CORS policy;
- provisioning, reconciliation, suspension, deletion, or administrative APIs for external identity bindings;
- automatic creation or linking of model principals from external identities;
- gateway credential storage, rotation, network policy, pool sizing, timeouts, retry policy, and deployment topology;
- nested gateway-role membership; the 0.12 reference profile provisions runtime logins as explicit members;
- read-query audit policy and transport request-to-database trace correlation;
- HTTP caching, conditional requests, idempotency keys, retries, request deduplication, pagination, batching, streaming, and subscriptions;
- compatibility negotiation for independently deployed manifests, clients, servers, and database boundaries;
- package publication, generated-server deployment, observability, and rate limiting;
- frontend form/table generation, alternate transports, alternate enforcement backends, and AI/MCP consumers.
