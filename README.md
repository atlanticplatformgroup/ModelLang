# ModelLang 0.32 reference compiler

ModelLang compiles a small domain ontology into an authenticated application boundary backed by PostgreSQL enforcement. The compiler produces a typed canonical IR with persistent semantic identity, reusable closed policies, reliable commands, typed domain events and consumers, one canonical enforcement decision plan, filtered public applicability, private transactional decision evidence, engineering policy coverage, a workflow-aware operation and UI boundary, deterministic provenance, guarded evolution, generated clients, and PostgreSQL enforcement.

Two canonical applications drive the language:

- Procurement proves authenticated callers, principal-scoped exactly-once command replay, atomic request lifecycle events with bounded publication failure disposition and isolated audited reopening, duplicate-safe `RequestApproved` consumption, bounded durable consumer failure disposition, isolated audited consumer recovery, and chained `ApprovalObserved` emission, reusable manager/finance authority, exact executed decision evidence, caller-scoped reads, guarded state transitions, audit snapshots, stale-read prevention, and restricted authority.
- Reservations proves reliable creation with bounded-publication `ReservationCreated` events, opt-in audited publication and consumer terminal recovery, duplicate-safe bounded-retry local indexing, and chained `ReservationIndexed` emission, parameterized reads, temporal rules, half-open intervals, atomic conflict detection, and concurrent double-booking prevention.

## Quick start

Requirements: Node.js 20 or newer and Docker with Compose.

```bash
npm install
npm run build
npm run model:check
npm run model:generate
npm run db:up
npm test
npm run demo
npm run demo:reservations
```

Stop and delete the local demo database with:

```bash
npm run db:down
```

PostgreSQL is published on port `55432` by default. Override it with `MODELLANG_PG_PORT`. Scripts use:

```text
postgresql://postgres:postgres@127.0.0.1:55432/modellang
```

Override that connection with `MODELLANG_DATABASE_URL`.

## CLI

During development, invoke the compiler through the package scripts or `tsx`:

```bash
npx tsx src/cli.ts check examples/procurement.model
npx tsx src/cli.ts build examples/procurement.model --out generated/scratch
npx tsx src/cli.ts print-ir examples/procurement.model
npx tsx src/cli.ts explain examples/procurement.model
npx tsx src/cli.ts assign-ids examples/procurement.model
npx tsx src/cli.ts migration previous-model.ir.json examples/procurement.model --out migration.sql
npx tsx src/cli.ts reviewed-migration previous-model.ir.json examples/procurement.model --plan reviewed-plan.json --out migration.sql
npx tsx src/cli.ts semantic-diff previous-model.ir.json examples/procurement.model --out semantic-diff.json
```

After `npm run build`, the executable is available as:

```bash
node dist/src/cli.js check examples/procurement.model
```

`build` writes to a temporary sibling directory and replaces the requested output only after every compiler stage and backend succeeds.

## What is generated

Each model has a generated subtree: `generated/procurement/` and `generated/reservations/`. Its `model.ir.json` is the only compiler-backend input. ModelLang 0.32 advances to IR21 with opt-in opaque keyset cursor pagination while preserving 0.31 bounded to-one traversal and unpaginated array results. IR9 through IR21 remain accepted evolution baselines; IR20 queries retain their unpaginated meaning without invented cursor identity. Both committed subtrees are golden fixtures and migration baselines.

`operations.json` is manifest v7 derived exclusively from canonical IR. It contains JSON-visible entity and enum types, the transitive query-reachable projection closure, explicit nested-projection dependency IDs, declared action/query inputs and outputs, stable operation IDs, array-or-page result cardinality, cursor contract revision for opted-in queries, authenticated caller context, action reliability and emitted-event IDs, and stable workflow bindings. Query outputs reference projection IDs rather than source entities. It contains no runtime events, leases, keys, receipts, request hashes, HTTP paths, SQL names, database roles, or connection details. `openapi.json` and the generated HTTP TypeScript boundary are derived from this manifest.

`events.json` is event manifest v5. It is the static typed event contract: stable event ID and name, payload entity ID, local or imported source contract, emitting action and consumer IDs, bounded or unbounded publication failure policy with static recovery eligibility, envelope v2, and the private-outbox/at-least-once delivery profile. It contains no queued payloads, principals, correlations, lease tokens, attempts, errors, dispositions, recovery audit, operator identity, outcomes, inbox state, or broker configuration.

`decisions.json` is enforcement decision plan v2. In addition to normalized action rules, loads, locks, absence projection, and revision components, it carries stable policies, exact-one branch semantics, composition, and per-rule policy use. It is internal and expression-bearing. Both generated applicability functions and mutation functions consume this plan, so execution cannot drift from preflight logic.

`capabilities.json` is public capability manifest v6, a filtered projection derived from the operation manifest and decision plan. It exposes action/input and emitted-event IDs, static reliability requirements, fixed applicability outcomes, safe explanation rule IDs, and opaque-revision behavior. It contains no command or event instances, keys, correlations, receipts, expressions, current state, SQL details, or authority grant.

`semantic.json` is engineering semantic manifest v13. It includes every projection and nested dependency, distinguishes bounded array and cursor-page query contracts, separates transitive query source read sets from disclosed shapes, and retains stable event publication failure and recovery policies plus consumers, accepted source contracts, delivery identity, bounded or unbounded consumer failure policy, recovery eligibility, rules, lock sets, local effects, and ordered downstream event IDs.

`ui.json` is UI manifest v7 derived exclusively from operation manifest v7. Query descriptors use `resultProjectionId` and expose cursor metadata only for opted-in page results; projection fields retain explicit nested-projection IDs. Entity descriptors remain available for action results and reference inputs but grant no read capability.

`provenance.json` records compiler version, generator profile, model and IR identity, and the role and SHA-256 content hash of every other generated artifact. It omits wall-clock timestamps and its own recursive hash, so identical compilation inputs remain byte-for-byte deterministic.

The PostgreSQL backend emits:

- roles and ownership;
- direct-login and shared-gateway identity bindings;
- entity tables, foreign keys, enum checks, annotations, invariants, and temporal exclusion constraints;
- initial-state and legal-edge workflow triggers;
- internal model-version, source-hash, migration-kind, and reviewed-plan-hash history;
- `SECURITY DEFINER` action functions;
- pure authenticated `SECURITY DEFINER` action-applicability functions generated from the same decision plan;
- private exact-authority evidence written transactionally with successful action audit;
- private principal-scoped command receipts with canonical SHA-256 request fingerprints, stored results, and audit/correlation links;
- a private transactional event outbox plus bounded lease/ack/release/failure functions, durable policy-derived publication disposition, and separately authorized audited recovery;
- private transactional inbox, consumer audit, stored-result replay, atomic downstream outbox insertion, policy-derived durable failure dispositions, and immutable recovery audit for isolated consumer and recovery roles;
- bounded cursor-based terminal publication and consumer failure observation through a separate execute-only role with immutable private inspection audit;
- immutable per-generation terminal-failure acknowledgement through a separate execute-only role, serialized with recovery and reflected only as a Boolean in private observation;
- immutable first-writer terminal-failure self-claiming through another execute-only role, serialized with recovery and reflected only as a Boolean in private observation;
- `SECURITY DEFINER` query functions with fail-closed filters and bounded, directly allowlisted projection results, including explicit acyclic to-one nested shapes and opt-in keyset cursor pages;
- execute-only application grants with no direct entity-table access;
- example-only deterministic seed data;
- idempotent administrative upgrades through the 0.29 private-failure-claim boundary.

The generated TypeScript clients expose only declared actions, queries, and action applicability. They have no generic table or mutation API. Caller identity is not an input field.

- `typescript/browser.ts` is the browser-safe entry point. Its HTTP client sends JSON to stable-ID execution and applicability routes, and its UI executor keeps assessment separate from execution. It contains no SQL, database adapter, Node.js, or PostgreSQL contract.
- `typescript/ui.ts` embeds the readonly UI manifest and exports operation-ID-indexed input/result types, structural workflow availability, target-binding transition types, and fail-closed executors.
- `typescript/http-server.ts` authenticates bearer context, validates exact closed input and output objects plus command headers, enforces query result bounds, dispatches stable operation IDs, maps RFC 9457 problems, and can bridge to an existing caller-bound generated database client.
- `typescript/gateway.ts` is a server-only shared-pool adapter. It binds verified issuer/subject claims for one transaction and never accepts a ModelLang principal ID.
- `typescript/client.ts` remains the server-side PostgreSQL client. It never forwards caller identity as a SQL argument; the database resolves it through the authenticated session boundary.
- `typescript/events.ts` exports typed event-envelope variants keyed by stable event identity and post-effect entity payload.
- `typescript/dispatcher.ts` is a server-only typed adapter for private outbox claim, acknowledgement, release, and lease-bound failure recording.
- `typescript/publication-recovery.ts` is a server-only typed adapter for isolated audited terminal-outbox reopening.
- `typescript/failure-observer.ts` is a server-only typed adapter for bounded private terminal-failure inspection; it has no recovery or dispatch operation.
- `typescript/failure-acknowledgement.ts` is a server-only typed adapter for audited acknowledgement of one current terminal recovery generation; it has no observation or recovery operation.
- `typescript/failure-claim.ts` is a server-only typed adapter for immutable first-writer self-claiming of one current terminal recovery generation; it exposes no claimant identity.
- `typescript/consumers.ts` is a server-only, broker-neutral adapter for invoking declared consumers through the execute-only database boundary and recording bounded private failure codes.

Query methods return typed projection arrays. Predicates and ordering may read source fields that are absent from the result, but generated PostgreSQL, OpenAPI, HTTP validation, TypeScript, and UI contracts disclose only selected keys and explicitly named acyclic to-one nested shapes. Generated workflow metadata exposes lifecycle edges without creating a generic mutation surface. Authentication, PostgreSQL exclusion, and workflow failures cross HTTP as typed `AuthenticationError`, `ConflictError`, and `TransitionError` values.

Named projections are closed allowlists:

```modellang
projection UserSummary from User {
  id;
  name;
}

projection RequestSummary @stableId("prj_70d694c9a0a274dc79c6168e47d25968") from PurchaseRequest {
  id @stableId("pfd_71d694c9a0a274dc79c6168e47d25968");
  amount @stableId("pfd_73d694c9a0a274dc79c6168e47d25968");
  status @stableId("pfd_74d694c9a0a274dc79c6168e47d25968");
  approvedBy: UserSummary @stableId("pfd_75d694c9a0a274dc79c6168e47d25968");
}

query myRequests @stableId("qry_4406b045404a48449282db804f6167a8")(
  caller actor: User
) returns RequestSummary from PurchaseRequest as request {
  authorize true;
  where request.requester == actor;
  orderBy request.id asc;
  limit 100;
}
```

The hidden `requester` field enforces row visibility but is never serialized. `approvedBy` is either a closed `UserSummary` or JSON `null`; selecting `approvedBy` without `: UserSummary` would retain the direct UUID encoding. Projection dependencies must be acyclic and callers cannot choose traversal paths or depth.

Generated values are equally absent from create assignments and public inputs. For example:

```modellang
id: UUID @id @generated(uuid) @immutable;
createdAt: DateTime @generated(now) @immutable;
```

PostgreSQL creates both values inside the action transaction, and the returned typed entity includes them.

Each generated subtree contains `model.mmd`, `enforcement.json`, and `enforcement.md`, making the relationship between declarations and executable enforcement visible.

## Event-publication boundary

Local events can opt into bounded lease-bound publication failure:

```modellang
event RequestApproved @stableId("evt_30d694c9a0a274dc79c6168e47d25968")
  payload PurchaseRequest retry maxAttempts 5 recovery manual;
```

The host claims private typed envelopes through a connection that can assume only `modellang_dispatcher`, publishes them through its chosen broker, then acknowledges, releases, or records a bounded stable failure code:

```ts
import {
  acknowledgeProcurementEvent,
  claimProcurementEvents,
  failProcurementEvent,
} from "./generated/procurement/typescript/dispatcher.js";

for (const event of await claimProcurementEvents(dispatcherDatabase, 100, 60)) {
  const { leaseToken, ...envelope } = event;
  try {
    await broker.publish(envelope);
    await acknowledgeProcurementEvent(dispatcherDatabase, event.id, leaseToken);
  } catch {
    const outcome = await failProcurementEvent(
      dispatcherDatabase,
      event.id,
      leaseToken,
      "ML_BROKER_UNAVAILABLE",
    );
    // The host owns retry timing and any broker-side dead-letter movement.
  }
}
```

Only an explicit failure recorded under the current unexpired lease increments the durable count. Release, lease expiry, and dispatcher crashes do not fabricate a failure. At the declared maximum the outbox row becomes private `deadLetter` state and is excluded from later claims.

An opted-in terminal publication can be reopened only through a separate client bound to `modellang_publication_recovery`:

```ts
import { recoverProcurementEventPublication } from "./generated/procurement/typescript/publication-recovery.js";

const recovery = await recoverProcurementEventPublication(
  publicationRecoveryDatabase,
  outboxEventId,
  "OPERATOR_REVIEWED",
);
```

Recovery resets the current failure cycle, preserves monotonic total failures, increments a generation, and writes exact private operator audit atomically. It does not claim or publish the event. A separately authorized dispatcher must later claim it through the ordinary lease path; ModelLang never looks up, reconstructs, or moves a broker message.

Terminal publication and consumer failures can be discovered only through a client bound to the separate `modellang_failure_observer` role:

```ts
import {
  observeProcurementTerminalConsumers,
  observeProcurementTerminalPublications,
} from "./generated/procurement/typescript/failure-observer.js";

const publications = await observeProcurementTerminalPublications(observerDatabase, { limit: 50 });
const consumers = await observeProcurementTerminalConsumers(observerDatabase, { limit: 50 });
```

The private projection is keyset paginated under a database-generated terminal-time cutoff and contains only stable contract identity, private event identity, bounded failure state, generation, static recovery eligibility, and current-generation acknowledgement and claim Booleans. Every successful page is privately audited. It excludes payloads, principals, correlations, decisions, receipts, fingerprints, stored responses, leases, reasons, claimant identity, acknowledgement/claim records, and broker details. Observation grants neither acknowledgement, claiming, recovery, nor dispatch authority.

A separately provisioned operator may mark one currently terminal recovery generation as seen without reopening it:

```ts
import {
  acknowledgeProcurementTerminalConsumer,
  acknowledgeProcurementTerminalPublication,
} from "./generated/procurement/typescript/failure-acknowledgement.js";

await acknowledgeProcurementTerminalPublication(acknowledgerDatabase, outboxEventId, "OPERATOR_REVIEWED");
await acknowledgeProcurementTerminalConsumer(
  acknowledgerDatabase,
  "consumer:con_10d694c9a0a274dc79c6168e47d25968",
  sourceEventId,
  "OPERATOR_REVIEWED",
);
```

Acknowledgement derives the current generation, terminal disposition, stable contract identity, and database operator from locked private state. It writes one immutable audit row per generation, changes no failure or delivery state, and serializes with recovery. The observer adds only `acknowledged: boolean` for the current generation; reason and operator remain private.

A separately provisioned operator may become the first claimant for one currently terminal recovery generation:

```ts
import {
  claimProcurementTerminalConsumer,
  claimProcurementTerminalPublication,
} from "./generated/procurement/typescript/failure-claim.js";

await claimProcurementTerminalPublication(claimantDatabase, outboxEventId);
await claimProcurementTerminalConsumer(
  claimantDatabase,
  "consumer:con_10d694c9a0a274dc79c6168e47d25968",
  sourceEventId,
);
```

Claiming derives the current generation, terminal disposition, stable contract identity, and claimant from locked private state. The first writer creates one immutable claim per generation; later attempts return only `alreadyClaimed` and never disclose the claimant. Claiming changes no failure, acknowledgement, delivery, broker, or domain state. The observer adds only `claimed: boolean` for the current generation.

## Event-consumer boundary

Consumers are declared beside their accepted event contract and remain outside the public action/query surface:

```modellang
consumer observeRequestApproval @stableId("con_10d694c9a0a274dc79c6168e47d25968") on RequestApproved(
  payload request: PurchaseRequest
) -> PurchaseRequest {
  authorize true;
  require is_approved: request.status == RequestStatus.APPROVED;
  retry maxAttempts 3;
  recovery manual;
  update request { approvalObserved = true; }
  emit ApprovalObserved;
}
```

The host-owned dispatcher publishes or receives an at-least-once envelope, removes broker-private lease data, and invokes the generated adapter with a connection that can assume only `modellang_consumer`:

```ts
import { deliverObserveRequestApproval } from "./generated/procurement/typescript/consumers.js";

const outcome = await deliverObserveRequestApproval(consumerDatabase, event);
```

The adapter does not acknowledge or move broker messages. It returns a closed `consumed`, `retry`, or `deadLetter` outcome. The host owns acknowledgement, backoff, queue movement, and destination selection; a crash or negative acknowledgement may redeliver the same event, which the transactional inbox safely replays. If failure recording is unavailable, the adapter returns non-terminal `retry` with `recorded: false` and never guesses a terminal outcome.

An opted-in terminal failure can be reopened only through a separate client bound to `modellang_recovery`:

```ts
import { recoverObserveRequestApproval } from "./generated/procurement/typescript/consumers.js";

const recovery = await recoverObserveRequestApproval(recoveryDatabase, eventId, "OPERATOR_REVIEWED");
```

Recovery resets the current failure cycle and writes private operator audit, but never invokes the handler or touches broker state. The host must separately arrange redelivery; the normal handler then revalidates the envelope, source contract, authorization, requirements, locks, invariants, workflow, and inbox identity.

Consumer emissions use the complete committed post-effect entity as payload. They inherit correlation from the consumed event, set causation to the consumed event instance ID, and record stable consumer provenance. Duplicate delivery returns before emission, so one committed consumer audit can produce at most one event at each declared ordinal.

## HTTP application boundary

Every action and query uses `POST` with a stable semantic-ID route:

```text
/operations/actions/<act_stable_id>
/operations/queries/<qry_stable_id>
/operations/actions/<act_stable_id>/applicability
```

Renaming a declaration changes its generated method name and OpenAPI summary, but not its route. Request objects reject unknown properties, including any caller-shaped property. The host validates the bearer credential and returns an executor already bound to the authenticated principal:

```ts
import {
  createProcurementDatabaseExecutor,
  createProcurementHttpHandler,
} from "./generated/procurement/typescript/http-server.js";

const handler = createProcurementHttpHandler(async (token) => {
  const callerBoundClient = await authenticateAndCreateClient(token);
  return callerBoundClient
    ? createProcurementDatabaseExecutor(callerBoundClient)
    : null;
});
```

The browser receives only the API base URL and a token provider:

```ts
import { ProcurementHttpClient } from "./generated/procurement/typescript/browser.js";

const procurement = new ProcurementHttpClient({
  baseUrl: "https://api.example.test",
  accessToken: () => session.accessToken,
});
```

An action marked `idempotency required;` must receive a stable key. Generated HTTP clients send `Idempotency-Key`, optional `X-Correlation-ID`, and optional `X-Causation-ID`; servers echo the effective correlation ID. The same principal, stable action ID, and key replay the one committed result only when the canonical typed inputs, expected revision, correlation, causation, and model source hash still match:

```ts
const opened = await procurement.openRequest(
  { amount: { currency: "USD", amount: "125.00" } },
  {
    idempotencyKey: crypto.randomUUID(),
    correlationId: requestTraceId,
  },
);
```

Equivalent concurrent retries serialize in PostgreSQL and return the same stored result. A reused key with changed command identity fails as `IdempotencyConflictError` without disclosing that result. An action not marked reliable rejects an idempotency key. Applicability endpoints reject command metadata and never create a receipt.

Applicability is a separate authenticated query. It reads current authoritative state, changes no model row, writes no action audit, and never grants execution authority:

```ts
const decision = await procurement.assessSubmitRequest({ request: request.id });

if (decision.status === "applicable") {
  // Execution still reloads, locks, authorizes, checks requirements, and applies
  // the effect transactionally. The revision only requests an explicit comparison.
  await procurement.submitRequest(
    { request: request.id },
    { expectedRevision: decision.revision },
  );
}
```

`authorize` failure is `denied`; `require` failure is `notApplicable`. Missing or invisible referenced entities use the same denial projection by default. Safe explanations contain only a category and stable rule ID allowlisted by `capabilities.json`. `stale` is possible only when an explicit opaque revision is supplied through generated options or a quoted HTTP `If-Match`. A successful applicability response is advisory and cannot bypass execution-time checks.

The 0.12 shared-pool path verifies a bearer credential in the host, maps it to stable external claims, and lets the generated gateway executor own one complete database transaction:

```ts
import { createProcurementGatewayExecutor } from "./generated/procurement/typescript/gateway.js";

const handler = createProcurementHttpHandler(async (token) => {
  const identity = await verifyAccessToken(token); // { issuer, subject } or null
  return identity ? createProcurementGatewayExecutor(gatewayPool, identity) : null;
});
```

The reference Procurement integration uses a single shared PostgreSQL pool and forces connection reuse across different callers and rollback paths. Token verification remains host-owned; request data can never select or override the ModelLang caller. The earlier direct-login executor remains supported.

## Framework-neutral UI boundary

A frontend can select descriptors by stable operation ID, render fields using their presentation discriminants, and execute through the authenticated browser client:

```ts
import {
  createProcurementUiExecutor,
  ProcurementHttpClient,
  ProcurementUiManifest,
} from "./generated/procurement/typescript/browser.js";

const client = new ProcurementHttpClient({
  baseUrl: "https://api.example.test",
  accessToken: () => session.accessToken,
});
const ui = createProcurementUiExecutor(client);
const openRequest = ProcurementUiManifest.actions.find(
  (action) => action.operationId === "action:act_1e35db0451b1461e941af6283d86dca2",
)!;

const request = await ui.execute(openRequest.operationId, {
  amount: { currency: "USD", amount: "125.00" },
}, { idempotencyKey: crypto.randomUUID() });
```

The manifest's `text`, `dateTime`, `enum`, `enumSet`, `entityReference`, and `money` presentations are data descriptions rather than prescribed HTML widgets. Default labels may be overlaid by stable ID for product copy or localization. Caller identity is never a form field, and operation visibility must not be treated as proof that the current caller is authorized. Relationship choices must come from a separately declared authorized query or trusted host data, never direct database access.

Workflow-aware applications can render the edges matching a returned entity's current state and execute the selected transition without presenting the entity target as a user-editable field:

```ts
import { createProcurementUiWorkflowExecutor } from "./generated/procurement/typescript/browser.js";

const workflows = createProcurementUiWorkflowExecutor(client);
const lifecycle = ProcurementUiManifest.workflows[0]!;
const submit = workflows.available(lifecycle.workflowId, request.status)[0]!;
const submitted = await workflows.executeTransition(submit.transitionId, request.id, {});
```

Availability is structural only: it matches the declared source state. It does not predict caller authorization, preconditions, concurrent state, or invariants. Execution still crosses authenticated HTTP and the complete PostgreSQL enforcement boundary, and callers must handle typed failures and stale-state refresh.

Applications may call `ui.assess(...)` or `workflows.assessTransition(...)` to combine structural discovery with authenticated current-state applicability. These methods remain separate from `execute(...)` and `executeTransition(...)`; their results carry `authority: "none"`.

## Stable identity and safe schema evolution

Durable declarations carry kind-specific opaque IDs:

```modellang
enum Role @stableId("enm_11111111111111111111111111111111") {
  MANAGER @stableId("emv_11111111111111111111111111111111")
}

entity PurchaseRequest @stableId("ent_7d617d617d617d617d617d617d617d61") {
  requester: User @stableId("fld_8a928a928a928a928a928a928a928a92");
}

action submit @stableId("act_11111111111111111111111111111111")(
  caller actor: User,
  request: PurchaseRequest
) -> PurchaseRequest {
  authorize actor == request.requester;
  update request { status = RequestStatus.SUBMITTED; }
}
```

The ID is semantic identity; the name is an editable source, API, and physical label. `assign-ids` adds missing IDs to enums, members, entities, fields, policies, policy branches, invariants, exclusions, actions, queries, workflows, and transitions without changing existing IDs. Audit rows store stable action, rule, policy, and authority IDs, so renames do not split decision history.

The migration command compares a released IR with current source exclusively by ID. ModelLang 0.10 plans new enums and members, new entities, nullable or default-backed fields, actions, queries, workflows, and workflow transitions. It also retains transactional renames for tables, columns, invariant constraints, temporal-exclusion constraints, and action/query functions.

The separate `semantic-diff` command is non-mutating and broader than migration planning. It reports identity, structure, policy, validation, authorization, execution-reliability, query-visibility, lifecycle, effect, and persistence changes as additive, restrictive, expansive, breaking, or requiring review. Semantic diff v4 compares policies, authority branches, and idempotency requirements by stable ID while leaving migration authority with the separate guarded planners.

Every migration checks the owner-controlled `schema_migrations` history against the previous IR's model ID, version, and source hash before changing anything. Structural DDL, workflow refreshes, the complete current action/query boundary, grants, and the new history record are applied in one transaction. A repeated or out-of-order migration fails with `ML_MIGRATION_BASELINE`.

Private operational upgrades 0.27–0.29 additionally maintain an owner-controlled singleton `runtime_profile`. The profile advances monotonically; applying an older operational artifact after a newer one fails before any runtime function is replaced with `ML_RUNTIME_PROFILE_DOWNGRADE`. Databases created before the ledger was introduced bootstrap it when they apply one of these upgrades.

Changes outside the automatic safe subset use a versioned JSON plan conforming to `schemas/reviewed-migration-plan.schema.json`. `reviewed-migration` requires exact source hashes, acknowledges every non-additive semantic change by stable ID, and supports typed literal/enum/copy-field backfills, scalar enum mappings, and explicitly accepted removals. The plan contains no raw SQL or callback surface. PostgreSQL execution takes offline locks, copies retained data into a deterministic staging schema with all current constraints, validates row counts and references, then replaces the old model schema and records the canonical plan hash in the same transaction. An invalid backfill rolls back before replacement. Version 1 rejects field-type and enum-set transformations, principal/schema replacement, and inferred rollback.

For an existing 0.11 database that is not otherwise receiving a model migration, apply the generated 0.12 backend upgrade with the same administrative credential used for installation:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/006_upgrade_0_12.sql
```

The artifact is transactional and idempotent. It first verifies the installed model ID, version, and source hash, then changes only the internal identity/audit boundary, generated callables, roles, and grants; it does not alter model entity data or migration history. A mismatched artifact fails with `ML_MIGRATION_BASELINE`. A normal generated safe migration includes the same upgrade automatically. The credential applying either path must be able to create/alter roles and assume `modellang_owner`. Production issuer/subject bindings are then provisioned through a trusted administrative path; the example seed values are demo-only.

Existing installations can add the 0.17 decision/applicability functions without changing entity data or migration history:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/007_upgrade_0_17.sql
```

This baseline-checked artifact transactionally redeploys actions from the canonical decision plan, installs applicability functions, and refreshes least-privilege grants. Safe and reviewed migrations redeploy the same boundary automatically.

Existing installations can add the private 0.18 evidence boundary without changing domain rows or migration history:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/008_upgrade_0_18.sql
```

The upgrade adds internal evidence columns and constraints, then redeploys decisions, actions, and grants. Historical audit rows remain evidence-unknown; ModelLang never reconstructs past exact authority from broad role snapshots. If model source also changes to introduce policies, that source evolution uses the applicable safe or reviewed migration path separately.

Existing installations can add the private 0.19 command-receipt and correlation boundary without changing domain rows or migration history:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/009_upgrade_0_19.sql
```

The baseline-checked artifact installs private receipts, adds nullable command links to historical audit rows, and redeploys actions and grants. It is transactional and idempotent. Existing history remains unchanged, and no past command receipt is fabricated. Receipt retention is deployment-governed; the generated runtime performs no automatic deletion.

Existing installations can add the private 0.20 transactional event boundary without synthesizing historical events:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/010_upgrade_0_20.sql
```

The baseline-checked artifact creates the outbox and execute-only dispatcher functions, then redeploys actions and grants. New action executions append their declared post-effect payloads atomically with state, audit, evidence, and receipts. Reliable-command replay inserts no second event.

Existing installations can add the private 0.21 transactional consumer boundary without consuming historical events:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/011_upgrade_0_21.sql
```

The baseline-checked artifact creates the isolated consumer role, private inbox/audit/failure tables, typed handlers, and execute-only grants. It is transactional and idempotent, fabricates no completion record, and does not run a handler for already queued or historical events.

Existing installations can add the private 0.22 transactional event-chain boundary without synthesizing downstream events:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/012_upgrade_0_22.sql
```

The baseline-checked artifact generalizes private outbox producer provenance, installs envelope-v2 dispatch and current handlers, and refreshes grants. It is transactional and idempotent, preserves existing action-produced events, and emits nothing until a new consumer execution commits.

Existing installations can add the private 0.23 durable consumer-failure boundary without fabricating historical failures:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/013_upgrade_0_23.sql
```

The baseline-checked artifact upgrades private failure state, installs policy-derived state and recorder functions plus current handlers, and refreshes execute-only grants. It is transactional and idempotent. Existing inbox completions remain authoritative, no historical attempt or terminal disposition is inferred, and a model change that adds or changes a consumer policy still uses reviewed evolution.

Existing installations can add the private 0.24 audited consumer-recovery boundary without reopening terminal failures:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/014_upgrade_0_24.sql
```

The baseline-checked artifact installs the isolated recovery role, recovery-cycle state, immutable private audit, execute-only recovery function, current handlers, and grants. It is transactional and idempotent. It fabricates no recovery, operator identity, handler execution, inbox completion, or broker operation.

Existing installations can add the private 0.25 bounded publication-failure boundary without fabricating delivery history:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/015_upgrade_0_25.sql
```

The baseline-checked artifact adds private copied publication policy, recorded-failure count, terminal disposition, and lease-bound failure recording, then redeploys producers and grants. Existing outbox rows retain unbounded retry. The upgrade is transactional and idempotent and invents no failure, dead letter, publication, lease, or broker operation.

Existing installations can add the private 0.26 audited publication-recovery boundary without reopening terminal rows:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/016_upgrade_0_26.sql
```

The baseline-checked artifact installs copied recovery eligibility, monotonic total failures, recovery generations, immutable private audit, an isolated execute-only recovery role, and current producers/grants. Existing rows remain ineligible, including existing terminal rows. The upgrade is transactional and idempotent and fabricates no recovery, operator, audit, claim, publication, lease, or broker operation.

Existing installations can add the private 0.27 terminal-failure observation boundary without changing failure state:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/017_upgrade_0_27.sql
```

The baseline-checked artifact installs the isolated observer role, immutable private observation audit, bounded keyset functions, indexes, typed server adapter, and least-privilege grants. It is transactional and idempotent and fabricates no observation, recovery, failure, claim, publication, consumer execution, or broker history. It refuses to replace a runtime already advanced beyond profile 27.

Existing installations can add the private 0.28 terminal-failure acknowledgement boundary without changing failure state:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/018_upgrade_0_28.sql
```

The baseline-checked artifact installs the isolated acknowledger role, immutable per-generation publication and consumer acknowledgement audit, acknowledgement functions, updated private observer projection, typed server adapter, and least-privilege grants. It is transactional and idempotent, preserves all existing state, fabricates no acknowledgement history, and refuses to replace a runtime already advanced beyond profile 28.

Existing installations can add the private 0.29 terminal-failure self-claim boundary without changing failure or acknowledgement state:

```bash
psql "$MODELLANG_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f generated/procurement/postgres/019_upgrade_0_29.sql
```

The baseline-checked artifact installs the isolated claimant role, immutable first-writer publication and consumer claim records, claim functions, updated private observer projection, typed server adapter, and least-privilege grants. It is transactional and idempotent, preserves all existing state, and fabricates no claim history.

The safe planner continues to refuse removals, existing semantic changes, required fields without defaults/generation, data-dependent unique additions, enum-member value migration, and new invariants/exclusions on populated entity types. Policy and branch renames preserve stable identity, while changed policy signatures, branches, action authority, idempotency requirements, existing-event publication policies, or existing-consumer failure policies require reviewed evolution. Unsupported transformations still fail closed rather than becoming compiler guesses.

## Explicit language semantics

- A `policy` is a pure Boolean decision with typed parameters and stable named `allow` branches. Exactly one true branch succeeds; zero or multiple true branches fail closed, and null is never authority.
- An action authorization may use at most one positive conjunctive policy call. Its unique successful branch is the exact authority recorded on execution. No runtime component infers authority from expression text or a caller's complete role snapshot.
- Applicability remains a safe public projection with `authority: "none"`. Policy IDs, authority IDs, evidence, and revisions are not capability tokens and grant no execution authority.
- Successful execution records private model/source, action/rule, outcome, policy, and exact branch evidence after the effect in the same transaction. Rollback removes both state and evidence; application roles cannot read the internal audit table.
- `idempotency required;` makes the execution boundary require a 1–128 character key. The private command identity is authenticated principal plus stable action ID plus key; callers never supply principal identity.
- A reliable command claims its private receipt in the mutation transaction. Its SHA-256 fingerprint covers stable action ID, canonical typed callable inputs keyed by stable parameter ID, expected revision, correlation ID, and causation ID; model source hash is checked separately.
- A committed equivalent retry returns the stored result without re-authorizing or rechecking mutable state because it performs no new effect. A failed or rolled-back first attempt leaves no receipt, effect, or audit record. Changed input or source fails with `ML_IDEMPOTENCY_CONFLICT` and discloses no result.
- Correlation and causation IDs are execution metadata, never action inputs or capabilities. For reliable commands correlation defaults to the key; other actions receive a boundary-generated UUID (inside PostgreSQL for direct execution and at HTTP for response echoing). Receipts, fingerprints, and stored results remain owner-private.
- `event Name @stableId("evt_...") payload Entity retry maxAttempts N recovery manual;` declares a durable typed event with optional bounded publication failure and manual terminal recovery; omissions preserve unbounded retry or disable recovery. An action lists `emit Name;` after its effect, and the compiler requires the payload entity to match the returned post-effect entity.
- Event rows commit in the same transaction as mutation, invariants, audit, evidence, and receipt completion. Rollback removes all of them; reliable-command replay returns before event insertion.
- Delivery is explicitly at least once: the private dispatcher leases bounded batches with `FOR UPDATE SKIP LOCKED`, the host publishes externally, and an unexpired lease token gates acknowledgement or failure recording. A crash between publish and acknowledgement can redeliver the same stable event ID, so consumers deduplicate by ID.
- Publication failure recording atomically increments only an explicit lease-bound failure and returns `retry` or policy-derived `deadLetter`; release and lease expiry do not count. Terminal rows are excluded from claims. Opted-in recovery under a separate execute-only role restores claim eligibility, resets only the current cycle, preserves total failures, increments generation, and appends immutable private audit. Retry timing and all broker routing, lookup, reconstruction, movement, and publication remain host-owned.
- A `consumer ... on Event(payload value: Entity)` declaration binds one stable consumer identity to one exact local or imported event-source contract. Its payload is an immutable event snapshot, not authenticated caller identity or execution authority.
- Consumer invocation is execute-only through `modellang_consumer`. The closed envelope and complete typed payload are validated before the handler loads and locks local state, re-evaluates authorization and named requirements, applies one create/update effect, and records private evidence.
- The private inbox identity is stable consumer ID plus event instance ID. Its SHA-256 fingerprint covers the stable closed envelope except `deliveryAttempt`; equivalent concurrent duplicates serialize and replay one committed stored result, while changed content fails with `ML_EVENT_CONFLICT` without result disclosure.
- Inbox claim, local effect, consumer audit/evidence, completion, and stored result commit or roll back together. This is exactly-once local committed handling for one consumer identity over at-least-once transport, not exactly-once network delivery.
- A consumer may list distinct local `emit Event;` clauses after its effect. Each payload is the complete post-effect result; correlation is inherited, causation is the consumed source event UUID, and stable consumer identity is private producer provenance. The compiler rejects payload mismatches, imported emissions, duplicates, and local event cycles.
- Downstream outbox rows commit with the consumer effect, audit, inbox completion, and stored result. Duplicate replay returns before emission and never produces a second downstream row.
- `retry maxAttempts N;` counts durably recorded failed handler deliveries for one stable consumer and source-event identity. At the limit the generated adapter returns a durable `deadLetter` disposition; omission preserves unbounded retry.
- A successful handler resolves prior failure state atomically with its effect, audit, emissions, inbox completion, and result. Failure recording happens only after the failed handler transaction rolls back and cannot make a failed effect durable.
- `recovery manual;` is valid only with bounded retry and opts a consumer into isolated operational recovery. The authenticated recovery role may reopen only durable terminal state; application, gateway, dispatcher, consumer, and model principals have no recovery authority.
- Recovery serializes with handling and failure recording, resets only the current cycle count, preserves monotonic total failures, increments a generation, and commits exact private reason/operator audit. It invokes no handler and grants no handler authority.
- Terminal acknowledgement derives the current generation under the same failure-state lock as recovery, appends one immutable private audit row, and changes no disposition, count, eligibility, lease, inbox, outbox, domain, or broker state. Later attempts return only `alreadyAcknowledged`; a recovered generation's next terminal cycle begins unacknowledged.
- Terminal self-claiming derives the current generation and claimant under the same failure-state lock as recovery, appends one immutable first-writer record, and changes no acknowledgement, disposition, count, eligibility, lease, inbox, outbox, domain, or broker state. Later attempts return only `alreadyClaimed`; a recovered generation's next terminal cycle begins unclaimed.
- Runtime outbox/inbox rows, event payload instances, lease tokens, attempts, errors, dispositions, fingerprints, stored responses, consumer failure/recovery/acknowledgement/claim records, operator identities, reason codes, generations, and outcomes are absent from operation, capability, UI, OpenAPI, and agent-facing contracts. Event manifest v5 exposes only static publication failure/recovery policy. Generated adapters are broker-neutral; network publication, polling, broker acknowledgement, retry timing/backoff, retention, destinations, and message movement remain host-owned.

- Entity equality is identity equality. `actor == request.requester` compares the two `User` primary keys, never every field on the two rows. The canonical IR marks this as `entityIdentity`, and PostgreSQL lowers it to UUID comparison.
- `caller actor: User` is semantic context, not a user-supplied action or query argument. It is omitted from both the generated SQL and TypeScript callable signatures. A direct login resolves through the owner-controlled `session_user` binding; a gateway transaction resolves through an owner-controlled `{issuer, subject}` binding.
- A `workflow` targets one required stored enum field, declares its initial state, and binds each legal edge to one update action. The compiler verifies that the action has a named source-state requirement and writes the declared destination, rejects undeclared state writes, and requires every enum state to be reachable.
- PostgreSQL workflow triggers require initial-state inserts and reject skipped or otherwise undeclared update edges. They are durable state-shape backstops; transition authorization, locking, assignments, and auditing remain explicit in the bound generated action.
- Added fields on existing entities must be nullable or have a constant/database-generated default. Added enum members refresh existing constraints, and added workflow edges replace the trigger function without weakening its initial-state or edge checks.
- Migration history is an internal enforcement boundary. Application roles cannot read or edit it, and the target version is recorded only if the full migration commits.
- `Money<USD>` is an exact nominal type, distinct from `Money<EUR>`, `Decimal`, and JavaScript numbers. Currency literals are explicit (`USD 10000`), PostgreSQL stores exact `numeric` values behind profile constraints, and TypeScript uses `{ currency: "USD", amount: "10000.00" }`.
- `@generated(uuid)` and `@generated(now)` are valid only on required `UUID` and `DateTime` stored fields respectively. Actions cannot assign them. PostgreSQL supplies qualified column defaults and returns the values from the same create statement.
- Generated fields are implicitly immutable. `@immutable` also prevents update effects from assigning ordinary stored fields while still allowing their explicit initial assignment during creation.
- A query declares one source entity, query-level authorization, a per-row `where` policy, a required direct ordering field, and a fixed limit from 1 through 1000. The compiler adds ascending primary-key order as a deterministic tie-breaker. Authorization and filtering both use `IS TRUE`, so false and SQL unknown fail closed. Optional `paginate cursor;` changes only that query to a closed `{ items, nextCursor }` result with an optional cursor input; page size, sorting, offsets, and page numbers remain unavailable to callers.
- Query entity parameters are callable UUIDs but must resolve to existing rows. Missing callable entities project as the query's authorization failure, matching the default absence/invisibility policy. Query functions use a statement-level MVCC snapshot and do not lock result rows or write action-audit records.
- Invariants are exactly directional as written. The Procurement model uses `approval_fields_match_status`, which requires approval fields to be both populated exactly when a request is `APPROVED` and null for every other status.
- Procurement also uses durable audit backstops: an approved request must snapshot `MANAGER` authority at or below 10,000 or `FINANCE` authority above 10,000, and its approver must differ from its requester.
- `@snapshot` is valid on stored scalar, enum, and enum-set entity fields and marks a point-in-time audit copy. The compiler never auto-populates it: an action must explicitly assign either `null` or a compatible direct field value such as `actor.roles`. That value is copied into the row; later changes to the source field do not propagate.
- `PurchaseRequest.amount` is `Money<USD> @minExclusive(0)`, so its currency is fixed and zero is never valid in storage. `openRequest` retains `positive_amount` as an action-level, named guard and clearer diagnostic; the two layers are intentionally defense in depth.
- `Set<Role>` stores multiple duplicate-free enum members. Enum-set membership policies lower to fail-closed database enforcement. Procurement explicitly permits `EMPLOYEE`, `MANAGER`, or `FINANCE` to open requests instead of deriving that permission from seed-data role combinations.
- Procurement approval requires an authorized role and a different requester identity. Managers and finance users cannot approve requests they opened themselves.
- Enum sets are unordered domain values represented as constrained PostgreSQL `text[]` and generated TypeScript enum arrays. Unknown, null, and duplicate members are rejected by named constraints.
- `noOverlap(resource, startsAt, endsAt)` defines required half-open intervals `[start, end)`. Adjacent reservations are legal; overlapping intervals for the same entity identity are rejected atomically. The PostgreSQL backend emits a strict interval check and GiST exclusion constraint.

## Security guarantee and trust boundary

For a direct session authenticated as a provisioned application login possessing only `modellang_app` privileges, or a server session explicitly provisioned through `modellang_gateway`, every generated state change is attributed to an owner-bound model principal and constrained by generated authorization, preconditions, invariants, deterministic row locks, and table privileges.

The proof relies on these operational assumptions:

- `modellang_owner` is `NOLOGIN`.
- Application processes never connect as a superuser, `modellang_owner`, or a migration role.
- Application logins are not members of `modellang_owner` and cannot `SET ROLE` into it.
- Migration credentials are isolated from normal application runtime credentials.
- Recovery-role credentials are isolated from application, gateway, dispatcher, consumer, browser, and agent runtimes.
- Failure-observer, failure-acknowledger, and failure-claimant credentials are mutually isolated and separate from application, gateway, dispatcher, consumer, recovery, browser, and agent runtimes.
- Dispatcher credentials are isolated from application, gateway, consumer, recovery, browser, and agent runtimes.
- Principal bindings are provisioned only through a trusted administrative path.
- The host cryptographically verifies issuer/subject credentials before constructing a gateway executor.
- The shared gateway database credential is confined to trusted server code and never reaches a browser or caller.
- Database authentication is already trustworthy; this PoC does not solve password, secret, host, or infrastructure compromise.

Both principal-binding tables are owned by `modellang_owner`; runtime roles cannot read or modify them. Direct identity uses `session_user`, not `current_user`, because a security-definer function changes `current_user` to its owner. Gateway identity is accepted only for an explicit member of `modellang_gateway`, activated transaction-locally, and discarded by commit or rollback. An unbound session fails before authorization.

Gateway action audits preserve the database principal, resolved model principal, issuer, subject, model/source identity, stable rule, exact policy authority when present, and correlation/causation links. Direct-login audit rows keep issuer and subject null. Ordinary app roles cannot read decision evidence or command receipts, or override their direct binding by setting gateway-shaped PostgreSQL configuration values.

Application roles can use the model schema and execute generated action and query functions. They cannot directly select, insert, update, delete, or truncate model tables; create objects in generated schemas; read principal bindings; or assume the owner role. PostgreSQL superusers, object owners, and migration authorities remain outside the guarantee by design.

The `modellang_recovery` role is operational authority only for the generated recovery function. It cannot read private tables or invoke consumer handlers, and reopening terminal delivery state does not bypass any later handler check. Its provisioning and credential governance remain outside the application-principal model.

## Concurrency and fail-closed rules

The compiler discovers every statically identifiable entity row read by guards and effects. Update targets use `FOR UPDATE`; other mutable dependencies, including the authenticated principal, use `FOR SHARE`. Locks are acquired in canonical entity/source order before any guard or effect expression is evaluated, and evaluation uses only records returned by lock-bearing queries.

Authorization, preconditions, and invariants succeed only when their SQL value is exactly true. Each boundary is emitted with `IS TRUE`; false and SQL unknown both reject the operation. Optional enum and min/max field constraints explicitly permit null before applying their value constraint.

Read queries evaluate authorization before scanning result rows, apply their row policy inside the generated function, and return one deterministically ordered bounded array. They intentionally use no result-row locks because no authorization-dependent mutation follows the read.

The integration suite proves concurrency with transaction barriers and observed `pg_stat_activity` lock waits:

- a request amount changed while approval waits is re-read and re-authorized;
- a manager role set changed while approval waits is re-read and re-authorized;
- two concurrent approvals yield exactly one success, one failed precondition, and one audit record.
- manager and finance approvals persist distinct exact authority branch IDs, and an explicit transaction rollback leaves neither the domain row nor its evidence.
- a concurrent overlapping reservation waits on PostgreSQL’s exclusion constraint, then exactly one reservation and audit record survive.
- equivalent sequential and concurrent reliable-command retries return one stored result with exactly one row, receipt, and audit record; changed inputs conflict, keys are principal-scoped, and rollback removes a claimed receipt.

## Tests

Run the complete local quality gate (strict TypeScript build, ESLint, unused file/dependency analysis, and all tests):

```bash
npm run health
```

Run compiler and backend tests without PostgreSQL:

```bash
npm run test:unit
```

Run live database tests after `npm run db:up`:

```bash
npm run test:integration
```

The full suite validates reliable-command replay and conflicts, bounded event-publication failure/disposition, lease-transition races, event-consumer duplicate serialization, bounded consumer failure counting and terminal disposition, isolated recovery authority, recovery-cycle reset, monotonic counts, operator audit and rollback, success resolution, atomic downstream emission and rollback, correlation/causation propagation, cycle rejection, canonical fingerprints, policy typing, reuse, stable identity, recursion and ambiguity rejection, exact durable authority, receipt/inbox/evidence rollback, parsing and spans, migration planning and live row preservation, baseline rejection, workflow contracts, exact money, generated values, operation/UI/event/semantic/provenance schemas, semantic change classification, caller rules, query policies, deterministic output, privileges, auditing, invariants, conflicts, and real races.

## Deliberate PoC boundaries

- Enums use text plus named `CHECK` constraints for deterministic DDL and explicit migration control.
- Expressions support literals, paths, Boolean operators, and comparisons only. Money is exact and currency-typed, but arithmetic, allocation, tax, exchange, rounding, string operations, aggregates, and computed values require explicit future semantics.
- Direct per-user PostgreSQL logins remain a supported adapter. The generated 0.12 gateway is the shared-pool adapter and accepts only verified issuer/subject claims, never arbitrary principal IDs.
- Lock planning is sound for finite entity rows identified by action parameters. Temporal `noOverlap` is the one supported predicate rule and uses a PostgreSQL exclusion constraint. General collections, aggregates, absence checks, and other phantom-sensitive rules remain unstable.
- Queries intentionally omit inferred joins, reverse or collection traversal, aggregates, optional authored filters, caller-controlled sorting and limits, offset/page-number pagination, full-text search, and read-audit policy. ModelLang 0.32 supports only explicit bounded to-one projection traversal and opt-in fixed-limit keyset cursors.
- Enum sets intentionally omit literals, defaults, API parameters, equality, ordering, algebraic operations, incremental mutation, and role inheritance in 0.4.
- Workflows intentionally omit parallel or hierarchical states, cross-entity lifecycles, wildcard edges, entry/exit hooks, timers, asynchronous events, compensation, and framework-specific workflow controls.
- Policy v1 intentionally omits structured payloads, deny branches, priorities, multiple action authorities, recursive/effectful policies, public traces, signed evidence, and authority inference from arbitrary expressions.
- Safe evolution intentionally omits removals, type/default/generation/mutability changes, arbitrary backfills, enum stored-value transformations, workflow rewrites, online DDL scheduling, down migrations, and distributed deployment orchestration in 0.10.
- The 0.12 gateway profile intentionally leaves token formats and verification libraries, trusted issuer/audience policy, binding administration, credential rotation, cookie/CSRF/CORS policy, caching, transport retry scheduling, package publication, deployment, and observability to the host.
- Reliable commands intentionally omit automatic retry scheduling, receipt expiry/deletion, multi-action sagas, asynchronous recovery, external side-effect deduplication, cross-model keys, and signed/public receipts. Retention is deployment-governed.
- Event delivery intentionally omits network publication, broker-specific polling and acknowledgement, retry timing/backoff schedules, destinations or message movement, publication recovery/redrive, replay-message selection/retrieval, third-party assignment, release, reassignment, delegation, claim leases, workload balancing, approval workflows, notifications, alerts, dashboards, batch operations, bulk or automatic consumer recovery, authored separation of duties, retention, arbitrary payload transformations, imported-event emission, cyclic chains, cross-context translation, partition assignment, global ordering, sagas, and exactly-once network delivery. ModelLang supplies private lease-bound publication disposition, durable consumer failure accounting, opt-in single-event audited reopening, bounded observation, single-cycle acknowledgement, and immutable first-writer self-claiming only.
- UI manifest v7 intentionally omits framework components, layout, localization, entity option queries, authorization visibility/preflight, generic CRUD, prescribed pagination controls, optimistic concurrency, and client-side validation policy. It describes cursor continuation but leaves rendering to consumers. Alternate transports and AI/MCP generation remain deferred consumers of declared operations.
- Engineering semantic manifest v11 is intentionally a trusted static artifact, not an authorization-filtered capability view. Public policy traces, freshness lifetimes, general recovery workflows, external operations, extensions, target capability profiles, and agent/MCP generation remain future contracts.
- Elevated PostgreSQL authorities can bypass the boundary and are intentionally out of scope.

The normative 0.30 language is in [spec/0.30/LANGUAGE.md](./spec/0.30/LANGUAGE.md), with its [named read-projection contract](./spec/0.30/READ_PROJECTIONS.md), [conformance requirements](./spec/0.30/CONFORMANCE.md), and [unstable boundaries](./spec/0.30/UNSTABLE.md). Earlier claim, acknowledgement, observation, publication/consumer recovery, failure-disposition, event-chain, reliable-consumer, transactional-event, reliable-command, policy, applicability, reviewed evolution, semantic closure, workflow, UI, gateway, transport, and safe-evolution contracts remain normative where 0.30 does not replace them. The repository edition of [The Semantic Model Layer whitepaper](./docs/whitepaper/THE_SEMANTIC_MODEL_LAYER.md) records demonstrated, partial, and research-stage capabilities.
