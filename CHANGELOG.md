# Changelog

## 0.25.0

- Added optional `retry maxAttempts N` on local event declarations and preserved bounded or unbounded publication failure policy in canonical IR17.
- Copied stable-event publication policy into each committed outbox instance so later source changes cannot reinterpret durable delivery state.
- Added private lease-bound publication failure recording with exact durable counts, bounded error codes, policy-derived `retry`/`deadLetter`, terminal claim exclusion, and no inferred failure from release, lease expiry, or dispatcher crash.
- Added a generated server-only broker-neutral dispatcher adapter for typed claim, acknowledgement, release, and failure outcomes while keeping runtime payloads, leases, attempts, errors, dispositions, and outcomes out of public and agent contracts.
- Preserved isolated `modellang_dispatcher` authority and made competing acknowledgement, release, and failure transitions serialize through the live lease token; ModelLang still performs no network publication or broker administration.
- Advanced event manifest to v4, engineering semantic manifest to v9, semantic diff to v10, and generator profile to `/9`; existing-event publication-policy changes require reviewed acknowledgement.
- Added IR9–IR16 evolution normalization and baseline-checked idempotent `015_upgrade_0_25.sql`; existing outbox rows remain unbounded and no failure, terminal, publication, lease, or broker history is fabricated.
- Updated Procurement and Reservations with five-failure publication policy plus compiler, schema, privacy, adapter, lease race, terminal exclusion, migration, and live PostgreSQL coverage.

## 0.24.0

- Added optional `recovery manual;` on bounded consumers and preserved `none` or `manual` recovery policy in canonical IR16.
- Added an isolated `modellang_recovery` non-login role with execute-only access; application, gateway, dispatcher, consumer, owner, model-principal, and caller identities grant no recovery authority.
- Added atomic single-event terminal reopening with shared consumer/event serialization, current-cycle reset, monotonic total failure count, recovery generation, and fail-closed committed-inbox dominance.
- Added immutable private recovery audit containing stable consumer/event identity, prior counts and bounded error, generation, bounded reason code, authenticated database principal, and occurrence time.
- Added typed server-only `recover...` adapters while keeping failure/recovery state, operator identities, reason codes, generations, and outcomes out of operation, capability, UI, HTTP, event, and agent-facing contracts.
- Kept broker polling, acknowledgement, message selection/retrieval, requeue, movement, destinations, and retry timing host-owned; recovery invokes no handler and grants no handler authority.
- Advanced engineering semantic manifest to v8, semantic diff to v9, and generator profile to `/8`; existing-consumer recovery-policy changes require reviewed acknowledgement.
- Added IR9–IR15 evolution normalization and baseline-checked idempotent `014_upgrade_0_24.sql` without fabricated recovery, audit, execution, inbox completion, or broker state.
- Updated Procurement and Reservations with opted-in recovery plus compiler, schema, privacy, cycle, count, audit, rollback, migration, and live PostgreSQL coverage.

## 0.23.0

- Added optional consumer-local `retry maxAttempts N;` declarations with validated limits from 1 through 1000, preserved in canonical IR15 as bounded or unbounded failure policy.
- Added private durable failure state keyed by stable consumer plus source event, with atomically serialized attempt counts and policy-derived `retry`, `deadLetter`, and `resolved` dispositions.
- Added generated broker-neutral `deliver...` adapters with closed typed outcomes, durable-only terminal decisions, fail-safe unrecorded retry, and pre-handler terminal checks; broker acknowledgement, timing, movement, and destinations remain host-owned.
- Resolved prior failure state atomically with successful consumer effect, evidence, downstream emission, inbox completion, and stored result while keeping post-rollback failure telemetry outside the failed transaction.
- Kept failure records, attempts, dispositions, errors, payloads, and outcomes private; event manifest v3, operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, envelope v2, and stable HTTP routes remain unchanged.
- Advanced engineering semantic manifest to v7, semantic diff to v8, and generator profile to `/7`; existing-consumer policy changes require reviewed acknowledgement.
- Added IR9–IR14 evolution normalization and baseline-checked idempotent `013_upgrade_0_23.sql` without fabricated failures, retries, terminal dispositions, effects, or inbox completions.
- Updated Procurement and Reservations with three-attempt policies plus compiler, schema, adapter, privacy, conflict, concurrency, resolution, migration, and live PostgreSQL coverage.

## 0.22.0

- Added ordered local `emit Event;` clauses to stable typed consumers, preserved in canonical IR14 with compile-time payload, locality, uniqueness, and acyclic event-graph checks.
- Made consumer effect, exact evidence, downstream outbox insertion, inbox completion, and stored result one PostgreSQL transaction; duplicate replay returns before emission and cannot append a second downstream event.
- Added event-envelope v2 producer provenance: exactly one stable action or consumer ID, inherited correlation, and consumed source-event UUID causation. Legacy action envelopes are normalized before fingerprinting.
- Generalized the private outbox for action and consumer producers without exposing event instances, consumer evidence, inboxes, payloads, correlations, or leases through public application or agent-facing contracts.
- Advanced event manifest to v3, engineering semantic manifest to v6, semantic diff to v7, and generator profile to `/6`; operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, and stable HTTP routes remain unchanged.
- Added IR9–IR13 evolution normalization, reviewed consumer-emission changes, and baseline-checked idempotent `012_upgrade_0_22.sql` without historical emission or fabricated provenance.
- Updated Procurement and Reservations with one-step acyclic event chains plus golden, compiler, schema, replay, correlation/causation, rollback, migration, and live PostgreSQL coverage.

## 0.21.0

- Added stable typed `consumer ... on Event(payload value: Entity)` declarations plus exact imported event-source contracts, preserved in canonical IR13 with authorization, requirements, locks, effects, and duplicate-handling identity.
- Added an isolated `modellang_consumer` boundary with strict closed-envelope and typed-payload validation, transactional inbox deduplication, exact committed-result replay, private consumer audit/evidence, and bounded failure telemetry.
- Serialized equivalent concurrent deliveries by stable consumer ID plus event instance ID, rejected changed-envelope reuse with `ML_EVENT_CONFLICT`, and made inbox claim, local effect, evidence, completion, and result roll back together.
- Added broker-neutral server TypeScript adapters and explicitly retained at-least-once network delivery; polling, acknowledgement, retries, dead letters, retention, and transport selection remain host-owned.
- Advanced engineering semantic manifest to v5, event manifest to v2, and semantic diff to v6 while keeping operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, stable HTTP routes, and public privacy boundaries unchanged.
- Added IR9–IR12 evolution normalization, guarded consumer evolution, and the baseline-checked idempotent `011_upgrade_0_21.sql` without historical consumption or fabricated completion.
- Updated Procurement and Reservations with duplicate-safe local consumers plus golden, compiler, schema, privilege, conflict, concurrency, rollback, failure, migration, and live PostgreSQL coverage.

## 0.20.0

- Added stable typed `event ... payload Entity;` declarations and post-effect `emit Event;` clauses, preserved in canonical IR12 and validated against action result types.
- Added atomic private PostgreSQL event outboxes, isolated `modellang_dispatcher` lease/ack/release functions, replay suppression, rollback safety, deterministic within-action ordinals, and explicit at-least-once delivery semantics.
- Added event manifest v1 and generated TypeScript event-envelope unions; operation manifest v4, capability manifest v3, UI manifest v4, and engineering semantic manifest v4 now expose filtered static emission metadata.
- Added semantic diff v5 event/effect evolution, IR9–IR11 baseline normalization to IR12, reviewed acknowledgements, and the baseline-checked idempotent `010_upgrade_0_20.sql` without fabricated historical events.
- Updated Procurement with `RequestOpened`, `RequestSubmitted`, and `RequestApproved`, and Reservations with `ReservationCreated`, plus golden, compiler, schema, privilege, replay, rollback, and dispatcher coverage.

## 0.19.0

- Added the `idempotency required;` action declaration and advanced the canonical backend boundary to IR11.
- Added private principal/action/key-scoped PostgreSQL command receipts claimed in the mutation transaction, canonical SHA-256 typed-input fingerprints, exact committed-result replay, and fail-closed `ML_IDEMPOTENCY_CONFLICT` behavior.
- Added correlation and causation execution metadata, transactional receipt/audit/evidence links, rollback cleanup, and concurrency serialization for equivalent retries.
- Advanced operation manifest to v3, capability manifest to v2, UI manifest to v3, engineering semantic manifest to v3, and semantic diff to v4 with static reliability projections and guarded idempotency-change classification.
- Added generated TypeScript execution options and typed idempotency errors plus HTTP `Idempotency-Key`, `X-Correlation-ID`, and `X-Causation-ID` handling without changing stable operation routes or JSON body shapes.
- Added the baseline-checked, idempotent `009_upgrade_0_19.sql` administrative upgrade and IR10-to-IR11 safe/reviewed evolution support.
- Added live sequential replay, conflicting reuse, principal scoping, concurrent retry, private linkage, failed execution, and explicit rollback conformance coverage.

## 0.18.0

- Added first-class stable-ID `policy` declarations with typed parameters, pure composition, and closed named `allow` authority branches.
- Defined exact-one policy evaluation: zero matches deny, multiple matches fail closed, null never grants authority, recursion and side effects are prohibited, and action authorization admits one positive conjunctive authority policy.
- Advanced the canonical boundary to IR10 and enforcement decision plan v2 so policy identity, calls, branch expressions, ambiguity behavior, and rule use are shared by applicability and execution.
- Added private durable execution evidence with model/source identity, stable action/rule/policy/authority IDs, executed outcome, and ordered passed requirements, written transactionally with action audit.
- Kept operation manifest v2, UI manifest v2, capability manifest v1, HTTP routes, safe public explanations, and applicability responses unchanged; public decisions continue to carry `authority: "none"` and grant no authority.
- Updated Procurement approval to use a reusable exact manager/finance policy while retaining the broader role snapshot only as contextual domain history.
- Added engineering semantic manifest v2 policy use/coverage reporting, enforcement mapping, and semantic diff v3 policy/branch identity analysis.
- Added the baseline-checked idempotent `008_upgrade_0_18.sql` evidence upgrade and integrated evidence infrastructure with safe and reviewed migrations, including IR9 baseline compatibility.
- Added compiler, schema, golden, transport, migration, and live PostgreSQL proofs for policy typing, recursion/ambiguity fail-closed behavior, applicability/execution agreement, exact authority, private evidence, upgrade idempotence, and rollback atomicity.

## 0.17.0

- Added enforcement decision plan v1 as the single generated source for action applicability and transactional action checks.
- Added filtered public capability manifest v1 with stable action/input IDs, fixed outcomes, safe explanation rule IDs, opaque revisions, and explicit non-authority metadata.
- Added authenticated, side-effect-free PostgreSQL applicability functions where authorization failure is `denied`, requirement failure is `notApplicable`, and missing action entities use the same denial projection.
- Added explicit opaque revision comparison: `stale` requires caller-supplied state, while execution locks and re-evaluates current authorization and requirements before comparing and mutating.
- Added stable action applicability routes, strict quoted `If-Match`, ETag projection, closed response validation, OpenAPI schemas, and typed `StaleError` transport mapping.
- Added browser, server, gateway, UI, and workflow applicability helpers while keeping discovery, assessment, and execution as separate methods.
- Added the baseline-checked transactional `007_upgrade_0_17.sql` artifact and integrated decision redeployment into safe and reviewed migrations.
- Added normative contracts, schemas, golden artifacts, and live Procurement proofs for purity, safe explanations, denial/absence indistinguishability, explicit stale comparison, and execution-time re-evaluation.

## 0.16.0

- Added a versioned reviewed-migration plan with exact released/current source hashes, stable-ID semantic acknowledgements, typed field values, and scalar enum mappings.
- Added canonical object-order-independent plan hashing and recorded reviewed plan hashes alongside model/source provenance in migration history.
- Added `modelc reviewed-migration` as a separate guarded authority while preserving the narrower automatic safe planner unchanged.
- Added PostgreSQL-first offline transactional rebuilds that lock previous tables, validate retained rows in a constrained staging schema, verify row counts and references, and replace the model schema only after validation succeeds.
- Added explicit support for acknowledged entity/field removal, required-field backfill, scalar enum replacement, and changed current constraints/callables without adding raw SQL or callback escape hatches.
- Kept field-type conversions, enum-set transformations, principal/schema replacement, inferred rollback, and unmatched plan intent fail-closed.
- Advanced semantic diff to v2 to identify both separate guarded migration planners without making diff analysis executable authority.
- Added normative contracts, JSON Schema, unit coverage, and a live Procurement migration proof including failed-backfill rollback, history provenance, callable redeployment, and stale-baseline rejection.

## 0.15.0

- Added engineering semantic manifest v1 with typed rules, stable dependencies, read sets, lock plans, explicit assignments, linked postconditions, workflow bindings, failure classes, and source spans.
- Kept the full semantic manifest outside the browser/API contract and marked it unfiltered, current-state-free, and non-executable.
- Added deterministic artifact provenance v1 with compiler, generator, model, IR, role, and SHA-256 identity for every generated artifact.
- Added a non-mutating stable-ID-aware semantic diff that classifies identity, structure, validation, authorization, visibility, lifecycle, effect, and persistence changes without claiming general logical implication.
- Added `modelc semantic-diff` while preserving the separate guarded migration planner as the only migration authority.
- Preserved `.model` grammar, canonical IR9, operation manifest v2, UI manifest v2, HTTP routes and operation shapes, PostgreSQL enforcement, and schema-migration behavior.
- Added versioned schemas, normative 0.15 contracts, golden artifacts, conformance coverage, and a repository edition of the whitepaper with explicit implementation status and profile gaps.

## 0.14.0

- Added operation manifest v2 entity identity-field metadata and workflow metadata with stable workflow, transition, state, action, and callable target bindings.
- Added UI manifest v2 workflow descriptors with initial/terminal states, stored state values, generated labels, edges, and additional transition fields.
- Added typed browser helpers for structural state-based transition selection without claiming authorization or precondition success.
- Added a browser-safe workflow executor that binds neutral entity `targetId` to the declared action parameter and dispatches through authenticated HTTP.
- Kept caller identity out of transition input and made unknown workflow and transition IDs fail closed as typed validation errors.
- Preserved `.model` grammar, canonical IR9, HTTP routes and operation shapes, PostgreSQL enforcement, and schema-migration behavior.
- Added manifest-schema, golden, browser-safety, runtime target-binding, terminal-state, and live Procurement workflow integration coverage.

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
