# ModelLang 0.12 — PostgreSQL Gateway Identity

Status: normative design contract for the 0.12 reference compiler.

## Purpose and boundary

The 0.11 HTTP boundary required a caller-bound operation executor but demonstrated PostgreSQL with one database login per model principal. ModelLang 0.12 adds a production-shaped alternative: many authenticated principals may share a dedicated PostgreSQL gateway credential and connection pool without making a principal UUID part of the request, browser client, operation manifest, or generated HTTP contract.

The gateway adapter is server-only. PostgreSQL remains an implementation backend behind the operation executor.

```text
verified bearer credential
        |
        v
{ issuer, subject } claims
        |
        v
generated gateway executor
        |
        +-- acquire pooled connection
        +-- BEGIN
        +-- bind issuer + subject for this transaction
        +-- execute one declared action or query
        +-- COMMIT or ROLLBACK
        +-- release connection
```

## Verified identity contract

A gateway identity is the pair `{ issuer, subject }` from one successfully verified authentication credential. Both values are required, non-empty strings of at most 512 characters. The pair, not either component alone, is the durable external identity key.

The host is responsible for cryptographic token verification and for enforcing its issuer, audience, algorithm, expiry, not-before, revocation, and credential-lifecycle policy before constructing `VerifiedGatewayIdentity`. Merely decoding a token is not verification.

The host must never derive gateway identity from JSON request data. It must never accept a ModelLang principal UUID as an authentication claim that bypasses the owner-controlled binding. The generated browser client and operation schemas remain unable to send caller identity.

## PostgreSQL roles and bindings

The generated PostgreSQL profile defines three non-login group roles:

- `modellang_owner` owns generated objects and is never a runtime login;
- `modellang_app` may execute declared actions and queries but cannot access model tables directly;
- `modellang_gateway` inherits `modellang_app` execution authority and alone may call the gateway binding function.

A shared runtime login is provisioned as an explicit member of `modellang_gateway`. Ordinary direct-login principals are members of `modellang_app`, not `modellang_gateway`.

The owner-controlled `gateway_principal_binding` table maps `(issuer, subject)` to the primary-key identity of the model principal. The gateway login cannot read or modify this table. Bindings are provisioned only through a trusted administrative path. Multiple external identities may map to one model principal; each external pair maps to at most one principal.

## Transaction-local activation

The generated gateway executor performs exactly one ModelLang operation per database transaction. It acquires a connection, begins a transaction, invokes `bind_gateway_identity(issuer, subject)`, executes the declared operation on that same connection, and commits. Any failure causes rollback before release.

The binding function verifies explicit membership of `session_user` in `modellang_gateway`, verifies that the external identity is bound, and stores issuer and subject with PostgreSQL transaction-local configuration. Transaction-local state is discarded by both commit and rollback. A generated action or query resolves gateway context only when `session_user` is an explicit gateway member; otherwise it resolves the existing direct `session_user` binding.

Ordinary application roles cannot activate gateway mode. Setting similarly named PostgreSQL configuration values does not change their direct identity. A gateway operation with missing, stale, or unknown context fails with `ML_IDENTITY_UNBOUND` before authorization or data access.

Possession of the shared gateway database credential is a trusted-server capability: its holder can choose any administratively bound issuer/subject pair. ModelLang prevents request-data spoofing and pooled-connection leakage; it does not make a compromised gateway host or credential safe.

## Audit provenance

Every action audit row continues to record the stable action ID, resolved model principal, target, database `session_user`, and transaction timestamp. Gateway actions additionally record `identity_issuer` and `identity_subject`. These columns are symmetrically null or non-null: direct-login actions store both as null; gateway actions store both verified external identity components.

Queries remain unaudited, preserving the existing query policy.

## Generated TypeScript adapter

`typescript/gateway.ts` is a server-only generated entry point. It accepts a structural PostgreSQL-like pool and a `VerifiedGatewayIdentity`, and returns the same operation-executor interface consumed by the generated HTTP handler. It has no method accepting a ModelLang principal ID.

The adapter copies and validates identity at construction. Every execution obtains its own pooled connection and owns the complete begin/bind/operation/commit-or-rollback lifecycle. Connections are never released with an open transaction.

`typescript/browser.ts`, `operations.json`, and `openapi.json` contain no gateway pool, database role, SQL, issuer/subject binding function, or principal-selection contract.

## Existing direct-login mode

Direct PostgreSQL logins remain supported and retain their 0.11 behavior. Their model principal is selected exclusively by the owner-controlled `principal_binding.database_principal = session_user` mapping. Gateway settings are ignored for these roles, including settings they attempt to forge manually.

The generated database-executor bridge remains available for hosts that intentionally use direct caller-bound clients.

## Upgrade behavior

Fresh 0.12 installations include gateway roles, bindings, resolver functions, audit provenance, and least-privilege grants. Generated safe migrations also add this internal boundary idempotently in the same transaction, after physical renames and before callable redeployment.

Because the gateway role is cluster-wide, a 0.12 installation, standalone upgrade, or first 0.12-generated safe migration must run under an administrative credential that can create and alter roles as well as assume `modellang_owner`. Later migrations retain the same bootstrap statements so a missing or weakened gateway role fails closed or is restored.

Each model additionally generates `postgres/006_upgrade_0_12.sql`. An existing 0.11 installation that is not otherwise performing a model migration applies this administrative, transactional artifact once. The artifact first requires the installed model ID, version, and source hash to match its generated baseline; a mismatched or missing history fails with `ML_MIGRATION_BASELINE` and rolls back the role bootstrap. It then creates the gateway boundary, redeploys actions and queries to use the identity resolver, and reapplies grants without changing model entity data or migration history.

The upgrade creates no production identity bindings. An administrator must provision trusted issuer/subject mappings before directing authenticated traffic through the shared gateway.

## Deliberate scope

Version 0.12 does not prescribe an identity provider, token format, application framework, gateway deployment topology, secret manager, connection-pool library, cookie/CSRF/CORS policy, identity-binding administration API, automatic principal creation, read auditing, or alternate database backend.
