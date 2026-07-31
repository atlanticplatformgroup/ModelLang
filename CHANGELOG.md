# Changelog

## 0.13.0

- Added deterministic UI manifest v1 generation from operation manifest v1 without changing `.model`, canonical IR9, HTTP, migration, or PostgreSQL semantics.
- Added stable-ID action-form, query-filter/table, enum-option, and entity-field descriptors with humanized default labels.
- Added transport-neutral presentation metadata for scalars, entity references, enums, enum sets, exact money, generated fields, immutability, nullability, and snapshots.
- Kept authenticated caller identity out of every form and filter and made the manifest explicitly declare `callerInput: false`.
- Added a browser-safe generated TypeScript UI manifest and typed stable-ID executor over the existing authenticated HTTP client.
- Made unknown UI operation IDs fail closed as typed ModelLang validation errors.
- Added JSON Schema, golden, rename-stability, browser-safety, runtime dispatch, and live Procurement API integration coverage.

## 0.12.0

- Added a dedicated non-login `modellang_gateway` PostgreSQL role for shared server credentials while preserving direct-login mode.
- Added owner-controlled `(issuer, subject)` bindings to model principals without adding caller identity to `.model` inputs, the operation manifest, OpenAPI, or browser clients.
- Added transaction-local gateway identity activation and a generated resolver that ignores forged gateway settings from ordinary application roles.
- Added a server-only generated TypeScript gateway executor that owns acquire, begin, bind, execute, commit-or-rollback, and release for one declared operation.
- Added symmetric issuer/subject provenance to action audit rows while retaining database-principal and resolved-principal attribution.
- Added an idempotent `006_upgrade_0_12.sql` artifact and integrated the same internal upgrade into guarded schema migrations.
- Added live Procurement HTTP tests using one shared pool, including forced connection reuse, concurrent callers, rollback cleanup, unbound identities, direct-login spoof attempts, and gateway audit provenance.

## 0.11.0

- Added deterministic operation manifest v1 generation from canonical IR9 without changing `.model` grammar or stored model shape.
- Added stable-ID action and query HTTP routes, OpenAPI 3.1.1 output, closed JSON request schemas, and bearer authentication declarations.
- Added a browser-safe generated TypeScript client that has no SQL, database adapter, Node.js, or PostgreSQL contract.
- Added a Fetch-standard generated server handler with authenticated operation executors, exact runtime input validation, and a 1 MiB default request limit.
- Kept caller identity out of request data and added a server-only bridge to generated caller-bound PostgreSQL clients.
- Added RFC 9457 problem responses and browser reconstruction of typed ModelLang authentication, identity, authorization, precondition, transition, invariant, conflict, not-found, and validation errors.
- Added manifest-schema, rename-stability, spoofing, error-sanitization, HTTP boundary, and live Procurement API integration tests.

## 0.10.0

- Added transactional safe schema evolution while retaining canonical IR version 9 for 0.9 baseline compatibility.
- Added automatic planning for enums/members, entities, nullable/default-backed fields, actions, queries, workflows, and workflow transitions.
- Added dependency-ordered table, field, constraint, foreign-key, enum-refresh, and workflow-refresh SQL generation.
- Added owner-controlled migration history containing model identity, version, source hash, and application time.
- Added fail-closed baseline verification with `ML_MIGRATION_BASELINE` and SQLSTATE `55000`.
- Added automatic transactional redeployment of generated actions, queries, and least-privilege grants.
- Rejected required additions without backfills, data-dependent unique additions, removals, and existing semantic changes.
- Preserved rename migrations under the guarded 0.10 transaction.
- Added unit and live PostgreSQL tests proving row preservation, defaults, new foreign keys, enum expansion, new callables, workflow expansion, history recording, and out-of-order rejection.

## 0.9.0

- Added first-class `workflow ... for Entity.field` declarations with explicit initial states and action-backed transitions.
- Added compile-time validation for required enum targets, initial defaults, source-state requirements, destination assignments, declared state writes, unique edges, and reachability.
- Extended stable semantic identity with `wfl_...` workflow and `trn_...` transition IDs and idempotent `assign-ids` support.
- Added canonical IR version 9 with ID-resolved workflow targets, states, transitions, and action bindings.
- Added PostgreSQL initial-state and legal-edge triggers with named `ML_WORKFLOW` failures.
- Added generated TypeScript workflow metadata and typed `TransitionError` mapping.
- Added workflow lifecycle edges to Mermaid and workflow contracts to enforcement artifacts.
- Made rename migration planning require workflow IDs and fail closed on workflow changes.
- Added compiler, code-generation, stable-ID, schema, and live PostgreSQL workflow conformance tests.

## 0.8.0

- Added exact nominal `Money<C>` types and explicit currency literals such as `USD 10000`.
- Added built-in USD, EUR, GBP, JPY, and KWD profiles with fixed precision and scale.
- Added canonical IR version 8 with currency, precision, scale, and exact literal text.
- Rejected implicit cross-currency operations and mixing Money with untyped numeric values.
- Added PostgreSQL exact-numeric storage, named money constraints, callable-parameter validation, and currency-bearing JSON results.
- Added generated TypeScript `Money<"C">`, runtime currency/decimal validation, and typed `ValidationError`.
- Migrated Procurement amounts, thresholds, invariants, actions, demos, and tests from `Decimal` to `Money<USD>`.
- Added compiler, code-generation, client, enforcement, and live PostgreSQL conformance tests.

## 0.7.0

- Added `@generated(uuid)`, `@generated(now)`, and `@immutable` stored-field semantics.
- Added canonical IR version 7 with explicit database generation authority and field mutability.
- Made generated fields required, database-owned, implicitly immutable, unassignable by actions, and distinct from source defaults and audit snapshots.
- Added qualified PostgreSQL UUID and transaction-timestamp defaults, generated-column omission, `DEFAULT VALUES` support, and same-transaction result returns.
- Removed caller-supplied IDs from the canonical Procurement and Reservations creation APIs and added database-generated creation timestamps.
- Added compiler, code-generation, schema, enforcement, typed-client, and live PostgreSQL coverage for generated values.

## 0.6.0

- Extended `@stableId(...)` to enums, enum members, invariants, temporal exclusions, actions, and queries.
- Added canonical IR version 6 with ID-based enum types, enum literals, operation ownership, rule IDs, enforcement entries, and action audit identities.
- Extended `modelc assign-ids` to every durable declaration supported by 0.6.
- Added identity-based rename planning for invariant and exclusion constraints and action/query PostgreSQL functions.
- Recognized enum declaration renames as semantic-only and made enum-member renames fail closed until stored-value migrations are supported.
- Migrated both canonical models to complete explicit declaration identity.
- Added unit and live PostgreSQL tests for stable reference lowering, complete ID assignment, broad rename planning, data preservation, constraint renames, and callable function renames.

## 0.5.1

- Prevented managers and finance users from approving their own purchase requests through both action authorization and a durable invariant.
- Added a durable approval-authority invariant that validates snapshotted roles against the approved amount.
- Made request-opening authorization explicit for employee, manager, and finance roles rather than relying on seed-data role combinations.
- Added generated-artifact, database-backstop, role-independence, and self-approval regression coverage.

## 0.5.0

- Added persistent `@stableId(...)` identities for entities and stored fields.
- Added canonical IR version 5 with identity strategy metadata and ID-based entity/field references.
- Added `modelc assign-ids`, which assigns missing cryptographically random IDs in place and is idempotent.
- Added deterministic previous-IR/current-source migration comparison.
- Added transactional PostgreSQL table and column rename generation.
- Made generated action and query routines replaceable for post-migration redeployment.
- Added fail-closed migration refusal for name-derived IDs, additions, removals, structural changes, and collisions.
- Migrated both canonical models to explicit stable IDs.
- Added unit and live PostgreSQL tests proving a renamed table/foreign-key column preserves data and enforcement.

## 0.4.0

- Added normative stored `Set<Enum>` fields and membership expressions.
- Added canonical IR version 4 with explicit enum-set types and `setMembership` semantics.
- Added PostgreSQL `text[]` storage with constraints rejecting undeclared, null, and duplicate members.
- Added fail-closed `member in set` lowering to PostgreSQL array membership.
- Extended `@snapshot` to copy complete enum sets as point-in-time audit context.
- Generated enum-union arrays in TypeScript entity types.
- Migrated Procurement from one mutually exclusive role to multi-role principals.
- Added compiler, codegen, database-constraint, multi-role authorization, and set-snapshot tests.

## 0.3.0

- Added normative authenticated query syntax and canonical IR version 3.
- Added query authorization, fail-closed row filters, direct-field ordering, deterministic ID tie-breakers, and compile-time limits.
- Added generated `SECURITY DEFINER` PostgreSQL query functions returning bounded JSON arrays.
- Removed direct entity-table `SELECT` from the application role; generated actions and queries are now the complete runtime database boundary.
- Added typed query inputs and array-returning methods to generated TypeScript clients.
- Added query nodes and read-policy entries to Mermaid and enforcement artifacts.
- Added caller-isolation, resource-isolation, missing-entity, direct-read denial, and query compiler conformance tests.

## 0.2.0

- Added normative versioned language, grammar, conformance, and unstable-boundary documents.
- Added canonical IR version 2.
- Added required `DateTime` ordering semantics.
- Added `exclusion ... noOverlap(key, start, end)` with half-open interval semantics.
- Added PostgreSQL strict-interval checks and atomic GiST exclusion constraints.
- Added generated `ConflictError` mapping for SQLSTATE `23P01`.
- Added the Reservations canonical application, generated artifacts, demo, and real concurrency tests.
- Preserved Procurement as the 0.1 compatibility application.
- Changed generated golden output to per-model subdirectories.

## 0.1.0

- Established the Procurement proof of concept and authenticated PostgreSQL enforcement boundary.
