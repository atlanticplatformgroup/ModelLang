# ModelLang 0.11 unstable transport boundaries

The following remain undefined or host-owned:

- production token validation, issuers, claims, refresh, revocation, and session lifecycle;
- cookie authentication, CSRF protection, browser credential modes, and CORS policy;
- a scalable PostgreSQL identity adapter replacing per-principal database logins;
- HTTP caching, conditional requests, idempotency keys, retries, and request deduplication;
- multipart, file, streaming, subscription, asynchronous, and batch operations;
- pagination and caller-controlled query ordering or limits;
- projections, joins, aggregates, and transport-specific result shaping;
- compatibility negotiation for independently deployed manifests, clients, and servers;
- package publication, generated-server deployment, observability, and rate limiting;
- frontend form, table, validation-message, and workflow-control generation;
- API transports other than the 0.11 JSON-over-HTTP profile.
