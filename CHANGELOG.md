# Changelog

## Unreleased

## 0.47.0

- Added deployment-configurable private caching for static MCP `server/discover` and `tools/list` results through generated `discoveryCacheTtlMs`, with a conservative zero default and no ModelLang-specific maximum below the protocol's non-negative safe-integer limit.
- Added deterministic SHA-256 discovery revisions over the exact generated catalog and related discovery schemas, recorded in MCP adapter v6 and exposed as strong `ETag` response metadata.
- Added response-kind-specific cache headers: successful positive-TTL discovery receives private `max-age` and complete authorization/protocol/routing variation, while zero-TTL discovery and every execution, current-state, packet, trace, delegation, extension, authentication-error, and protocol-error response remain `no-store`.
- Kept cached discovery non-authoritative: every request still authenticates independently and every operation re-enters current runtime authorization, policy, row visibility, validation, revision, and evidence enforcement.
- Added adapter-schema validation, deterministic revision coverage, invalid-TTL startup failures, unit response-header checks, and live PostgreSQL/MCP coverage proving discovery caching composes with zero-age execution and resource semantics.
- Advanced compiler/examples to 0.47.0, MCP adapter to v6, and generator profile to `postgresql-http-ui-mcp-discovery-cache/31`; canonical IR1, catalog v7, target profile v9 and target `/9`, assessment/evaluation formats, and all runtime envelope versions remain unchanged.

## 0.46.0

- Added generated SML-Agent assessment v1 as a conservative assurance artifact mapping all ten whitepaper criteria to supported, partial, or absent status with evidence and explicit gaps.
- Kept the assessment non-authoritative and explicitly partial: it claims neither complete SML-Agent conformance, agent competence, test execution, nor included live-model evidence.
- Added the deterministic `agent-adversarial-v1` suite for identity injection, operation-kind and metadata confusion, delegated-credential misuse, favorable-preflight replay, extension request-context isolation, private implementation disclosure, and MCP contract separation.
- Added live PostgreSQL coverage proving that a caller cannot reuse another subject's favorable revision-bound preflight and that malformed identity-bearing reads create no query evidence; live MCP rejects command/delegation metadata on the wrong tool kinds.
- Added provider-neutral agent evaluation suite and replay v1 formats, four canonical comparison conditions, six fixed Procurement scenarios, a driver interface, deterministic scoring, and a CLI validation/replay command.
- Marked the committed scoring replay and all scorer reports non-empirical and added no model-quality claim; stochastic provider runs remain optional and outside release conformance and health checks.
- Added schemas, specification, plan, whitepaper status, generated goldens, provenance classification, scorer unit tests, and model-generation coverage.
- Advanced compiler/examples to 0.46.0 and generator profile to `postgresql-http-ui-agent-assurance/30`; canonical IR1, catalog v7, MCP adapter v5, target profile v9 and target `/9`, extension ledger/result v1, public trace v1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.45.0

- Added catalog v7 extension-tool bindings for declared external extensions, with stable IDs, exact closed input schemas, exact result-envelope schemas, opaque semantic contract revisions, declared authorization context, conservative effects/reliability annotations, and explicit host responsibility.
- Added generated authenticated HTTP routes and typed client methods plus a request-bound host adapter that must affirm the exact contract revision, authorize every validated invocation, provide the implementation, and return a schema-valid result.
- Added MCP adapter v5 registration of extension tools under stable ID suffixes while keeping them separate from core action/query tools, resources, task packets, delegated capabilities, and public traces.
- Added extension tool result v1 with model/extension/revision identity, `authority: none`, explicit host-provided implementation/conformance/evidence markers, and no-store HTTP/MCP behavior; extension results are not current-state resources and produce no MCP embedded resource.
- Failed closed for missing or revision-mismatched adapters, host denial, malformed inputs, invalid host results, command metadata, and delegated credentials; discovery and successful invocation grant no ModelLang action authority.
- Preserved extension ledger v1 as private and non-executable with zero generated implementations and retained every external implementation target gap; ModelLang does not verify host implementation, effects, evidence, or tests.
- Added standalone/catalog/MCP schemas, OpenAPI, generated TypeScript, specification, whitepaper status, deterministic goldens, adversarial unit coverage, and live PostgreSQL HTTP/MCP composition tests.
- Advanced compiler/examples to 0.45.0, catalog to v7, MCP adapter to v5, target capability profile to v9, target to `target:postgresql-http-ui-extension-tools/9`, and generator profile to `postgresql-http-ui-extension-tools/29`; canonical IR1, extension ledger v1, public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.44.0

- Added public decision trace v1 as an authenticated, exact-input explanation of current action applicability through generated `POST /agent/decision-traces` clients/servers and the read-only MCP tool `modellang_public_decision_trace`.
- Reused the authoritative applicability evaluator and exposed ordered categorical authorization, requirement, and revision outcomes plus the existing safe applicability decision without executing actions or writing action-audit evidence.
- Established a strict disclosure boundary: traces omit operation inputs, current state values, authenticated identity, expressions, policy and authority identities, SQL, private `decision_evidence`, receipts, and event/consumer evidence.
- Made closure and freshness explicit: applicability-only scope, no observed execution, no durable evidence, no complete-trace claim, point-in-time transport time, zero reusable lifetime, revalidation before reuse, `authority: none`, and no-store HTTP/MCP metadata.
- Kept actions, current-state resources, task packets, delegated capabilities, and public traces distinct; trace calls reject command metadata and delegated credentials, and discovery never grants authority.
- Added standalone and exact schemas, OpenAPI, catalog/MCP bindings, generated TypeScript, specification, whitepaper status, deterministic goldens, adversarial unit coverage, and live PostgreSQL HTTP/MCP tests proving policy-sensitive outcomes and absence of audit writes.
- Advanced compiler/examples to 0.44.0, catalog to v6, MCP adapter to v4, target capability profile to v8, target to `target:postgresql-http-ui-public-decision-traces/8`, and generator profile to `postgresql-http-ui-public-decision-traces/28`; canonical IR1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.43.0

- Added delegated capability v1 for one currently applicable exact action/input, one named authenticated delegate, one audience, one required concurrency revision, one use, and a maximum one-hour lifetime.
- Added authenticated HTTP issuance and grantor-bound revocation, once-only opaque credential delivery with no-store/no-cache semantics, and HTTP action invocation through a separate `delegated-capability` credential that supplements ordinary delegate authentication.
- Added MCP action invocation through `_meta["dev.modellang/delegatedCapability"]` while keeping issuance HTTP-only and rejecting delegated credentials on queries, resources, applicability, subject views, task packets, issuance, and revocation.
- Required a host credential authority for secure storage, grantor/delegate binding, revocation, and atomic consume-and-execute; generated adapters validate exact model/catalog/action/input/audience/time/revision/attenuation constraints and re-enter the existing authoritative action runtime.
- Kept discovery non-authoritative and actions distinct from resources; no transferable or chained delegation, delegated task packets, prompts, subscriptions, public decision traces, extension-backed tools, or full SML-Agent conformance is claimed.
- Added standalone and exact schemas, OpenAPI, generated TypeScript, catalog/MCP bindings, specification, whitepaper status, deterministic goldens, adversarial unit coverage, and live PostgreSQL tests for delegate binding, policy enforcement, audit attribution, stale revisions, revocation, and replay rejection.
- Advanced compiler/examples to 0.43.0, catalog to v5, MCP adapter to v3, target capability profile to v7, target to `target:postgresql-http-ui-delegated-capabilities/7`, and generator profile to `postgresql-http-ui-delegated-capabilities/27`; canonical IR1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.42.0

- Added authenticated bounded task packet v1 assembly over exact action candidates and caller-selected declared query observations, available through generated HTTP clients/servers and a stable `/agent/task-packets` route.
- Reused authoritative action applicability and query execution paths so authorization, preconditions, row policies, projection disclosure, sorting, bounds, pagination, validation, concurrency revisions, and private transactional read evidence remain enforced at assembly time.
- Published selected static action schemas, safe failure/reliability/event/workflow metadata, current applicability decisions, and unchanged zero-age resource envelopes without executing actions or disclosing action/query input values or authenticated identity.
- Made closure limits explicit: packets declare independent reads, non-authority, zero reusable lifetime, no-store transport, partial closure, caller-selected rather than proven-relevant observations, and absent complete effect, reversibility, and recovery semantics.
- Advanced agent catalog to v4 and MCP adapter manifest to v2; MCP exposes the same exact assembler through `modellang_task_packet` and embedded task-packet resources without advertising MCP Tasks, prompts, templates, subscriptions, or delegated authority.
- Added standalone schema, OpenAPI, generated TypeScript, catalog/MCP bindings, specification, whitepaper status, deterministic goldens, unit tests, and live PostgreSQL tests proving subject-specific applicability, preserved query evidence, input omission, and absence of action audit writes.
- Advanced compiler/examples to 0.42.0, target capability profile to v6, target to `target:postgresql-http-ui-agent-task-packets/6`, and generator profile to `postgresql-http-ui-agent-task-packets/26`; canonical IR1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.41.0

- Added deterministic MCP adapter manifest v1 and generated stateless Streamable HTTP server adapters for MCP revision `2026-07-28`.
- Exposed every agent catalog v3 action and query under its stable MCP-compatible ID suffix with the catalog's exact JSON Schema 2020-12 input and output documents.
- Added per-request host-provided bearer authentication with expiry and exact resource-audience validation; verified identity stays in the authenticated executor context and every invocation retains authoritative runtime enforcement.
- Kept actions and resources distinct: actions return tool results, while successful queries additionally return embedded resource envelope v1 with input-hiding URIs, zero reusable lifetime, revalidation before reuse, and no-store metadata.
- Added namespaced MCP command metadata for revisions, idempotency, correlation, and causation without widening closed action inputs; query tools reject command metadata.
- Added manifest/schema/golden documentation, official client protocol tests, and live PostgreSQL coverage for authenticated actions, runtime policy denial, current-state reads, and private transactional read evidence.
- Advanced compiler/examples to 0.41.0, target capability profile to v5, target to `target:postgresql-http-ui-mcp/5`, and generator profile to `postgresql-http-ui-mcp/25`; canonical IR1, catalog v3, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.40.0

- Added one authenticated current-state agent-resource route per declared query, reusing the existing query executor for authorization, row filtering, disclosure, sorting, bounds, pagination, output validation, and private read evidence.
- Added resource envelope v1 with exact model/query identity, validated current query data, `authority: none`, and no echoed input, authenticated identity, extensions, expressions, runtime internals, or private evidence.
- Established a conservative freshness baseline: transport `retrievedAt`, point-in-time mode, zero reusable lifetime, revalidation before reuse, and `Cache-Control: no-store`; no commit-time, frozen-snapshot, as-of, cache, or authority claim is made.
- Added catalog v3 query resource bindings, generated OpenAPI/client/server support, standalone schema validation, command-metadata rejection, and live PostgreSQL coverage proving disclosure and transactional read evidence remain intact.
- Advanced compiler/examples to 0.40.0, target capability profile to v4, target to `target:postgresql-http-ui-agent-resources/4`, and generator profile to `postgresql-http-ui-agent-resources/24`; canonical IR1, operation manifest v11, and capability manifest v10 remain unchanged.

## 0.39.0

- Added authenticated `POST /agent/capabilities` subject views that filter exact action candidates through the existing authoritative applicability evaluator without executing actions or granting authority.
- Added closed, bounded requests for up to 32 distinct action IDs with exact action input and optional opaque revision; query tools remain static-catalog-only, and query-only models accept an empty candidate set.
- Added subject capability view v1 with only stable model/action identity, available or safe unavailable outcomes, and revisions where visibility permits; caller identity, candidate input, resource state, expressions, extensions, and private evidence are excluded.
- Added generated OpenAPI, browser-safe HTTP client, authenticated server routing, response schema, catalog linkage, target capability reporting, deterministic provenance, unit coverage, and live PostgreSQL gateway tests proving different subjects receive different overlays without action-audit writes.
- Advanced agent catalog to v2, target capability profile to v3, target to `target:postgresql-http-ui-agent-subject-view/3`, compiler/examples to 0.39.0, and generator profile to `postgresql-http-ui-agent-subject-view/23`; canonical IR1, operation manifest v11, and capability manifest v10 remain unchanged.
- Removed pre-release PostgreSQL operational upgrade artifacts and the private runtime-profile ledger. Fresh builds now emit one complete current installation baseline while current-to-current model migrations remain supported.
- Removed legacy event-envelope adaptation so consumers accept only the exact current envelope contract.

## 0.38.0

- Added deterministic `agent-tools.json` catalog v1 for every declared action and query, with stable identities, standalone closed JSON input/output schemas, exact authenticated HTTP bindings, failure classes, read-only annotations, and query bounds.
- Added filtered action applicability rule IDs and outcomes, reliability, and emitted-event metadata without publishing expressions, current state, extensions, runtime internals, or authority grants.
- Declared the catalog MCP-tool adaptable while explicitly declining direct MCP protocol and SML-Agent conformance; runtime authorization and precondition enforcement remain authoritative on every invocation.
- Added target capability `agents.staticToolCatalog`, advanced target capability profile to v2 and `target:postgresql-http-ui-agent-catalog/2`, and recorded the catalog as a hashed contract artifact in provenance v2.
- Reset the unreleased canonical format to IR1, removed IR9–IR26 schema normalization and migration fallbacks, and made evolution input strict-current-format while preserving migrations between two IR1 artifacts.
- Advanced compiler and examples to 0.38.0 and generator profile to `postgresql-http-ui-agent-tool-catalog/22`; operation manifest v11 and capability manifest v10 remain unchanged, and PostgreSQL generation now has one fresh current-runtime baseline.

## 0.37.0

- Added typed, stable `extension` declarations for externally implemented behavior, including ownership, implementation location, entity reads/writes, external calls, emitted events, reliability, authorization context, test obligations, rationale, and promotion criteria.
- Kept extensions explicitly non-executable: no action, query, consumer, HTTP route, public capability, generated client, or PostgreSQL function can invoke them.
- Added engineering-only extension ledger v1 with exact IR contracts and a summary that reports zero generated implementations.
- Added target capability profile v1 for `target:postgresql-http-ui/1`, reporting native required semantics and one explicit external implementation gap per declared extension with `authority: none`.
- Added compile-time checks for contract types, stable IDs, entity/event references, duplicates, supported implementation targets, host-retry idempotency, test obligations, and authorization on state-changing extensions.
- Added extension-aware semantic evolution: additions are additive, removals and governance/behavior changes require review, and typed contract changes are breaking.
- Advanced canonical IR to IR26, engineering semantic manifest/profile to v18, semantic diff to v19, artifact provenance to v2, and generator profile to `postgresql-http-ui-target-capabilities/21`; public manifests and private runtime profile 36 remain unchanged.
- Declared Procurement supplier risk review as an external gap while Reservations demonstrates complete native target coverage, with schema, privacy, deterministic golden, evolution, and unchanged live PostgreSQL coverage.

## 0.36.0

- Added terminal `audit reads;` for queries that require private transactional evidence without changing callable inputs or array/page result shapes.
- Bound each successful committed invocation to model/query identity and revision, direct or gateway identity, canonical request SHA-256, exact response SHA-256, result count, selected sort profile, continuation state, and transaction time.
- Stored no raw input, filter, cursor, response, row, or disclosed field value; the internal `query_audit` table remains inaccessible to application and generated operational roles.
- Defined exact transaction semantics: evidence is inserted after result construction, failures and denials append nothing, commit makes it durable, and caller rollback removes it.
- Added static read-evidence metadata to operation, OpenAPI, UI, engineering semantic, enforcement, provenance, and schema contracts while leaving public capabilities and response validation closed.
- Classified adding or removing read evidence as breaking with persistence risk and included audit mode in query/cursor revision identity.
- Added idempotent, baseline-checked `020_upgrade_0_36.sql`, advanced the private runtime profile to 36, and made older operational upgrades refuse downgrade redeployment.
- Advanced canonical IR to IR25, operation manifest to v11, capability manifest to v10, UI manifest to v11, engineering semantic manifest/profile to v17, semantic diff to v18, and generator profile to `postgresql-http-ui-transactional-read-evidence/20`.
- Opted Procurement `myRequests` into auditing with unit, schema, golden, privacy, exact-hash, rollback, gateway-attribution, upgrade, and live PostgreSQL coverage.

## 0.35.0

- Added `redactable` projection members and up to 32 query-local `disclose path when Boolean;` rules for conditional value disclosure without dynamic projection selection.
- Defined a stable required-key/nullable-value contract: true yields the projected value, while false, SQL unknown, or an absent rule yields JSON `null` and never omits the key or emits a sentinel.
- Restricted rules to explicit finite projection paths, rejected implicit traversal and duplicate or non-redactable targets, and required independent rules for every redactable nested ancestor.
- Lowered disclosure to static PostgreSQL `CASE WHEN (...) IS TRUE` expressions while preserving operation authorization, row policy, fixed ordering/limits, and the closed projection allowlist.
- Propagated nullability and fail-closed disclosure metadata through TypeScript, operation/OpenAPI/HTTP, UI, semantic, enforcement, provenance, and schema contracts; paginated query revisions now bind disclosure rules.
- Classified projection redaction eligibility changes as breaking, rule additions as expansive, removals as restrictive, and condition changes by Boolean semantic direction where provable.
- Advanced canonical IR to IR24, operation manifest to v10, capability manifest to v9, UI manifest to v10, engineering semantic manifest/profile to v16, semantic diff to v17, and generator profile to `postgresql-http-ui-conditional-field-disclosure/19`.
- Updated Procurement so draft request amounts remain present as `null` and become visible after submission, with compiler, transport, artifact, semantic-evolution, and live PostgreSQL coverage.

## 0.34.0

- Added up to 16 closed authored `sort name: row.field asc|desc;` profiles per query while retaining the required `orderBy` as the reserved `default` profile.
- Exposed an optional exact-enum `sort` input only on queries with alternate profiles; callers cannot choose arbitrary fields, directions, expressions, limits, offsets, or SQL.
- Generated static PostgreSQL `CASE` ordering and keyset branches with an invariant ascending identity tie-breaker, and bound cursor payloads, fingerprints, and revisions to the selected profile.
- Propagated stable profile identity, field, direction, and tie-breaker metadata through TypeScript, operation/OpenAPI/HTTP, UI, semantic, enforcement, provenance, and schema contracts without widening query authority or projection disclosure.
- Classified profile additions as additive and profile removal or field/direction changes as breaking, with IR9–IR22 baselines normalized to no profiles.
- Advanced canonical IR to IR23, operation manifest to v9, capability manifest to v8, UI manifest to v9, engineering semantic manifest/profile to v15, semantic diff to v16, and generator profile to `postgresql-http-ui-authored-sort-profiles/18`.
- Updated Reservations with `latestFirst` and `endingSoonest` profiles plus unit, transport, golden, semantic-evolution, and live PostgreSQL coverage including cross-profile cursor staleness.

## 0.33.0

- Added `?` on non-caller query parameters for authored optional filters; actions, policies, consumers, and caller parameters remain required.
- Defined omission and explicit JSON `null` as the same nullable input state, with no compiler-inferred predicate: only the model's explicit null-aware `where` expression can broaden visible rows.
- Propagated query-parameter optionality through nullable IR expressions, PostgreSQL entity loading and exact-money validation, TypeScript inputs and clients, operation and semantic manifests, closed OpenAPI/HTTP validation, UI filter descriptors, enforcement coverage, and cursor input fingerprints.
- Classified query input optionality changes as breaking callable-contract changes and retained fail-closed authorization, fixed ordering/limits, disclosure projections, and per-page policy evaluation.
- Advanced canonical IR to IR22, operation manifest to v8, capability manifest to v7, UI manifest to v8, engineering semantic manifest/profile to v14, semantic diff to v15, and generator profile to `postgresql-http-ui-optional-query-filters/17`.
- Updated Reservations with an optional `startsAtOrAfter` filter plus unit, transport, golden, and live PostgreSQL coverage for omission, explicit null, concrete filtering, invalid values, and filter-bound cursor staleness.

## 0.32.0

- Added opt-in `paginate cursor;` after a query's fixed authored limit while preserving array results and callable ABIs for unpaginated queries.
- Added closed `{ items, nextCursor }` page contracts and an optional generated cursor input; callers cannot select limits, offsets, page numbers, order fields, or directions.
- Generated PostgreSQL keyset continuation over the required order field plus ascending identity, reading at most `limit + 1`, returning at most `limit`, and emitting no `OFFSET`.
- Bound opaque deterministic cursor v1 to model ID/version/source hash, query stable ID/revision, ordering, authenticated principal, callable filter inputs, and the final returned key.
- Added explicit `ML_VALIDATION:cursor:<query-id>` malformed failures and `ML_STALE:cursor:<query-id>` binding failures while re-evaluating identity, authorization, and row policy on every page.
- Advanced canonical IR to IR21, operation manifest to v7, capability manifest to v6, UI manifest to v7, engineering semantic manifest/profile to v13, semantic diff to v14, and generator profile to `postgresql-http-ui-cursor-pagination/16`.
- Propagated cursor pages through closed OpenAPI schemas, database/HTTP/browser/UI TypeScript clients, HTTP input/output validation, UI descriptors, semantic closure, migration signatures, provenance, and breaking-change analysis.
- Updated Reservations as the canonical two-item page fixture with live PostgreSQL coverage for complete traversal, malformed cursors, filter-bound staleness, and principal-bound staleness; added normative 0.32 documentation and deterministic golden artifacts.

## 0.31.0

- Added explicit `referenceField: NestedProjection` members for bounded to-one relationship traversal while preserving direct entity-reference UUID encoding when no nested projection is named.
- Required nested projection targets to match the referenced entity and rejected unknown targets, scalar or collection traversal, mismatches, and cyclic projection dependencies.
- Advanced canonical IR to IR20 with optional projection-member `nestedProjectionId`; the finite acyclic authored dependency graph is the complete traversal bound.
- Generated correlated foreign-key PostgreSQL lookups that construct only the nested allowlisted JSON keys, with exact required-object versus optional-object-or-null behavior.
- Advanced operation manifest to v6, capability manifest to v5, UI manifest to v6, engineering semantic manifest/profile to v12, semantic diff to v13, and generator profile to `postgresql-http-ui-to-one-traversal/15` while retaining the locked decision, event, provenance, route, and private-runtime versions.
- Published only transitive query-reachable projection dependencies and generated recursive closed OpenAPI schemas, TypeScript interfaces, HTTP result validation, UI dependency metadata, semantic read/disclosure closure, and Mermaid traversal edges.
- Classified direct-to-nested and nested-target changes as breaking, and made automatic-safe migration treat transitively reachable nested projections as public query contracts. IR9–IR19 remain accepted evolution baselines without fabricated traversal.
- Updated Procurement with nullable `approvedBy: UserSummary`, Reservations with required `resource: ResourceSummary`, deterministic golden artifacts, normative 0.31 documentation, and live PostgreSQL/HTTP tests for nested disclosure and null behavior.

## 0.30.0

- Added stable named `projection ... from Entity` declarations with independent `prj_` and `pfd_` identity and mandatory `query ... returns Projection from Entity` result contracts.
- Made projections closed direct-field allowlists: query predicates and ordering can read hidden source fields, while PostgreSQL constructs only selected JSON keys and preserves scalar, enum, exact-money, UUID/reference, DateTime, generated-value, snapshot, and nullable encodings.
- Advanced canonical IR to IR19 with all projections, projection-member source-field identity, and query `returnProjectionId`; projection order remains non-semantic and projections carry no authority or row policy.
- Advanced operation manifest to v5, capability manifest to v4, UI manifest to v5, engineering semantic manifest/profile to v11, semantic diff to v12, and generator profile to `postgresql-http-ui-read-projections/14`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, HTTP routes, and private runtime profile 29 remain unchanged.
- Derived closed OpenAPI projection schemas, exact HTTP output validation, typed projection-array database/HTTP/browser/UI clients, UI result columns, engineering disclosure sets, enforcement evidence, and Mermaid disclosure edges from the shared operation/IR contract.
- Added evolution comparison by projection and projection-field stable identity. Reachable member/source/type/nullability changes and query output changes are breaking; member reordering is ignored and stable projection renames remain identity-preserving.
- Normalized released IR9–IR18 query results internally as historical `legacyEntity` output without fabricating projection identity. Automatic-safe migration rejects narrowing to an explicit projection; reviewed migration requires stable acknowledgement.
- Updated Procurement with `RequestSummary`, Reservations with `ReservationSummary`, both example versions, deterministic golden artifacts, normative 0.30 specification, whitepaper status, and live PostgreSQL coverage for hidden fields and nullable selected keys.

## 0.29.0

- Added a separate non-login `modellang_failure_claimant` role with execute-only publication and consumer terminal-failure claim functions and no observation, acknowledgement, recovery, dispatch, consumer, application, query, or table authority.
- Added immutable first-writer claim records keyed by private terminal-cycle identity: outbox UUID plus trusted recovery generation for publication, and stable consumer ID plus source-event UUID plus trusted recovery generation for consumers.
- Derived generation, current disposition, stable contract identity, and claimant database principal from locked private state while accepting only private event identity.
- Serialized concurrent claims to one committed row and return closed `alreadyClaimed` outcomes without exposing the stored claimant or occurrence time.
- Serialized claiming and recovery through the same failure-state locks; claim-first history remains immutable, recovery-first claiming fails, and each later terminal generation begins unclaimed.
- Extended only the private observer projection with current-generation `claimed` Boolean and added the server-only typed `failure-claim.ts` adapter; operation manifest v4, capability manifest v3, UI manifest v4, event manifest v5, semantic manifest v10, semantic diff v11, HTTP, MCP, and agent-facing contracts remain unchanged.
- Added baseline-checked idempotent `019_upgrade_0_29.sql`; all existing failure, recovery, acknowledgement, observation, outbox, inbox, domain, decision, receipt, and broker state is preserved and no claim history is fabricated.
- Retained canonical IR18 because the release adds a private generated operational boundary, advanced the generator profile to `/13`, and updated both example models and deterministic golden fixtures to 0.29.0.

## 0.28.0

- Added a separate non-login `modellang_failure_acknowledger` role with execute-only publication and consumer acknowledgement functions and no observation, recovery, dispatch, consumer, application, query, or table authority.
- Added immutable acknowledgement audit keyed by private terminal-cycle identity: outbox UUID plus trusted recovery generation for publication, and stable consumer ID plus source-event UUID plus trusted recovery generation for consumers.
- Derived generation, current disposition, stable contract identity, and database operator from locked private state while accepting only private event identity and a bounded stable reason code.
- Serialized equivalent concurrent acknowledgements to one committed row and return closed `alreadyAcknowledged` outcomes without exposing stored reason or operator.
- Serialized acknowledgement and recovery through the same failure-state locks; acknowledgement-first history remains immutable, recovery-first acknowledgement fails, and each later terminal generation begins unacknowledged.
- Extended only the private observer projection with current-generation `acknowledged` Boolean and added the server-only typed `failure-acknowledgement.ts` adapter; operation manifest v4, capability manifest v3, UI manifest v4, event manifest v5, semantic manifest v10, semantic diff v11, HTTP, MCP, and agent-facing contracts remain unchanged.
- Added baseline-checked idempotent `018_upgrade_0_28.sql`; all existing failure, recovery, observation, outbox, inbox, domain, decision, receipt, and broker state is preserved and no acknowledgement history is fabricated.
- Retained canonical IR18 because the release adds a private generated operational boundary, advanced the generator profile to `/12`, and updated both example models and deterministic golden fixtures to 0.28.0.

## 0.27.0

- Added a separate non-login `modellang_failure_observer` role with execute-only access to bounded terminal publication and consumer failure inspection; observation grants no recovery, dispatch, consumer, application, query, or table authority.
- Added deterministic keyset pagination under a database-generated terminal-time cutoff, with validated private cursors and a hard page bound of 100.
- Added minimal server-only observation projections containing stable contract identity, private event identity, bounded failure state, terminal time, recovery generation, and static recovery eligibility while excluding payloads, principals, correlations, decisions, receipts, fingerprints, stored responses, leases, and broker details.
- Added immutable private inspection audit recording authenticated operator, kind, cutoff, continuation position, requested and returned counts, and page continuation in the observation transaction.
- Added generated typed `failure-observer.ts` adapters while keeping operation manifest v4, capability manifest v3, UI manifest v4, event manifest v5, semantic manifest v10, semantic diff v11, HTTP, MCP, and agent-facing contracts unchanged.
- Added baseline-checked idempotent `017_upgrade_0_27.sql`; existing failure, recovery, outbox, inbox, domain, decision, and receipt state remains unchanged and no observation history is fabricated.
- Retained canonical IR18 because the release adds a private generator boundary rather than new model semantics, and updated both example models and golden fixtures to 0.27.0.

## 0.26.0

- Added optional `recovery manual` on bounded local event declarations and preserved `none` or `manual` publication recovery in canonical IR18.
- Copied recovery eligibility into each committed outbox instance so later source changes cannot retroactively enable existing or terminal rows.
- Added isolated `modellang_publication_recovery` execute-only authority with atomic `deadLetter` to `pending` reopening, current-cycle reset, monotonic total failures, recovery generations, and no dispatcher or table authority.
- Added immutable private publication-recovery audit containing outbox and stable-event identity, prior cycle and total counts, prior bounded error, generation, bounded reason, authenticated database principal, and occurrence time.
- Added a generated server-only typed publication-recovery adapter while keeping runtime state, counts, errors, dispositions, generations, reasons, operators, audit, and outcomes out of public and agent-facing contracts.
- Kept claim, publication, acknowledgement, retry timing, message lookup/reconstruction/movement, destinations, and broker redrive host-owned; recovery only restores ordinary dispatcher eligibility.
- Advanced event manifest to v5, engineering semantic manifest to v10, semantic diff to v11, and generator profile to `/10`; existing-event recovery-policy changes require reviewed acknowledgement.
- Added IR9–IR17 evolution normalization and baseline-checked idempotent `016_upgrade_0_26.sql`; existing rows remain ineligible and no recovery, audit, operator, claim, publication, lease, or broker history is fabricated.
- Updated Procurement and Reservations with opted-in publication recovery plus compiler, schema, privacy, authority, cycle, total-count, audit, rollback, migration, and live PostgreSQL coverage.

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
