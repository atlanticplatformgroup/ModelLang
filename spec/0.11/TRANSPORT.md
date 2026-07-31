# ModelLang 0.11 — Operation Transport

Status: normative design contract for the 0.11 reference compiler.

## Architecture and boundaries

The canonical typed IR remains the only compiler-backend input. ModelLang derives a transport-neutral operation manifest from canonical IR, then derives OpenAPI and TypeScript HTTP artifacts from that manifest:

```text
.model source
    |
    v
canonical IR9
    |
    v
operation manifest v1
    +------------------------+
    |                        |
    v                        v
OpenAPI 3.1             TypeScript HTTP boundary
                             |
                    +--------+--------+
                    |                 |
                    v                 v
             browser client     authenticated server
                                      |
                                      v
                              operation executor
                                      |
                                      v
                         PostgreSQL client/backend
```

The manifest contains no HTTP paths, SQL names, database roles, connection details, or PostgreSQL types. It identifies declarations by canonical semantic ID and represents only JSON-visible types, authenticated caller context, declared inputs, result cardinality, and declared operation kind.

The manifest has its own `manifestVersion`. Its compatibility is independent of the canonical IR version.

## Operation contract

Every declared action and query produces exactly one manifest operation:

- the operation ID is the canonical stable semantic ID;
- the operation name remains the editable ModelLang declaration name;
- the kind is `action` or `query`;
- callable parameters appear in canonical callable order;
- the caller parameter is recorded as authenticated context and is never an input;
- an action returns one entity representation;
- a query returns an array of entity representations bounded by its declared query limit.

Entity references serialize as UUID strings. `Decimal` serializes as an exact decimal string. `DateTime` serializes as an RFC 3339 string. `Money<C>` serializes as `{ "currency": "C", "amount": "..." }`. Enum sets serialize as duplicate-free arrays of declared enum values.

Generated HTTP request schemas are closed objects. Missing, unknown, null where disallowed, or incorrectly typed properties fail before operation execution. In particular, a request property named after the caller parameter is an unknown property and is rejected.

Generated handlers also validate executor results against manifest entity shapes and query bounds before serialization. Missing, unknown, null where disallowed, incorrectly typed, or over-limit result data fails as a sanitized internal server error. This prevents a custom executor from silently widening the public response contract.

## HTTP mapping

The 0.11 HTTP profile uses JSON over `POST` for actions and queries. Query operations use `POST` because current and future declared query input can be structured, exact-valued, and authenticated; HTTP cache semantics are not inferred by the compiler.

Routes are derived from stable semantic IDs:

```text
POST /operations/actions/<act_stable_id>
POST /operations/queries/<qry_stable_id>
```

Renaming an action or query changes generated TypeScript method names and OpenAPI summaries but does not change its HTTP route. Removing or replacing its stable ID remains governed by safe-evolution rules.

OpenAPI output conforms to OpenAPI 3.1.1 and describes bearer authentication, exact closed request objects, typed successful responses, and ModelLang problem responses. An application may mount the generated handler under any origin or prefix; the browser client receives that base URL at construction.

The generated handler accepts at most 1 MiB of JSON request content by default. It rejects unsupported methods, unsupported media types, unknown operation paths, malformed JSON, and invalid request shapes before calling the operation executor.

## Authenticated caller binding

HTTP bearer credentials are transport context, not ModelLang input. The generated handler extracts the bearer credential and passes it to a host-supplied authenticator. The authenticator returns an operation executor already bound to the authenticated principal, or no executor when authentication fails.

Neither the generated handler nor browser client accepts a caller entity ID. The executor receives only the canonical operation ID and validated callable input.

For the PostgreSQL backend, the generated database-executor bridge wraps an existing generated database client. The host must construct that client with a connection whose `session_user` binding represents the authenticated principal. The reference Procurement integration maps opaque demo bearer credentials to role-specific caller-bound pools on the server. It does not send database credentials or principal IDs to the browser.

A production identity adapter may use different credential validation or connection selection, but it must preserve the same property: request data cannot select or override the ModelLang caller.

## Errors

HTTP failures use `application/problem+json` as defined by RFC 9457. ModelLang problem types use stable `https://modellang.dev/problems/<kind>` identifiers and include extension members:

- `code` for a backend or transport error code when safe to expose;
- `ruleId` for the canonical enforcement rule or boundary when available.

Generated browser clients reconstruct the corresponding typed ModelLang error class from the problem type. Authentication, identity binding, authorization, precondition, workflow transition, invariant, conflict, not-found, and validation failures remain distinguishable across the transport.

Unexpected server failures return a generic internal-error problem. Raw database messages, SQL text, credentials, causes, and stack traces are not returned to clients.

## Host responsibilities

The generated boundary deliberately does not choose an application framework. It uses the standard Fetch `Request`, `Response`, and `fetch` interfaces so Node.js, workers, and browser tooling can adapt it without a framework dependency.

The host remains responsible for:

- validating bearer credentials and selecting the caller-bound executor;
- TLS, origin policy, CORS, rate limiting, logging, tracing, and deployment;
- ensuring request bodies are not buffered ahead of the generated size check by an unsafe adapter;
- isolating migration credentials from runtime credentials;
- keeping independently deployed clients and servers on compatible manifests.

## Deliberate scope

Version 0.11 does not add `.model` syntax, change canonical IR9, replace PostgreSQL caller binding, generate a standalone web server process, prescribe token formats or issuers, implement cookie authentication or CSRF policy, infer caching, add pagination, publish packages, or generate frontend forms and tables.
