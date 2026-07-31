# ModelLang 0.17 reference compiler

ModelLang compiles a small domain ontology into an authenticated application boundary backed by PostgreSQL enforcement. The compiler produces a typed canonical IR with persistent semantic identity, a workflow-aware transport-neutral operation manifest, one canonical enforcement decision plan, a filtered public capability contract, authenticated side-effect-free applicability, a trusted engineering semantic manifest, a framework-neutral UI manifest, deterministic artifact provenance, OpenAPI, browser-safe HTTP and typed UI/workflow clients, an authenticated server handler, guarded safe and explicitly reviewed schema evolution, stable-ID-aware semantic change reports, explicit action-backed workflows, exact currency-typed money, database-owned generated values, constrained tables, a server-side database client, a Mermaid graph, and a rule-to-enforcement map.

Two canonical applications drive the language:

- Procurement proves authenticated callers, multi-role authorization, caller-scoped reads, guarded state transitions, audit snapshots, stale-read prevention, and restricted authority.
- Reservations proves parameterized reads, temporal rules, half-open intervals, atomic conflict detection, and concurrent double-booking prevention.

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

Each model has a generated subtree: `generated/procurement/` and `generated/reservations/`. Its `model.ir.json` is the only compiler-backend input. ModelLang 0.17 retains IR version 9, so released 0.9 and 0.10 IR remain valid migration baselines. IR9 separates persistent semantic identity from editable names, resolves workflow states and action bindings by ID, represents database generation and mutability independently from ordinary defaults, and preserves exact money profiles and literals. Typed expressions and generated enforcement refer to declarations by ID. Both committed subtrees are golden fixtures and migration baselines.

`operations.json` is manifest v2 derived exclusively from canonical IR. It contains JSON-visible entity and enum types, canonical entity identity-field IDs, declared action/query inputs and outputs, stable operation IDs, result cardinality, authenticated caller context, and stable workflow/transition/action/target bindings. It contains no HTTP paths, SQL names, database roles, connection details, PostgreSQL types, or UI concepts. `openapi.json` and the generated HTTP TypeScript boundary are derived from this manifest.

`decisions.json` is enforcement decision plan v1. It carries normalized authorization and ordered requirements, authoritative entity loads, execution locks, absence projection, and revision components. It is internal and expression-bearing. Both generated applicability functions and mutation functions consume this plan, so execution cannot drift from preflight logic.

`capabilities.json` is public capability manifest v1, a filtered projection derived from the operation manifest and decision plan. It exposes action/input IDs, fixed applicability outcomes, safe explanation rule IDs, and opaque-revision behavior. It contains no expressions, current state, SQL details, or authority grant. The generated `typescript/capabilities.ts` embeds the same browser-safe contract.

`semantic.json` is engineering semantic manifest v1. It exposes the static semantics already present in IR9: normalized authorization, precondition, and row-policy expressions; stable fact dependencies; read and lock sets; explicit effect assignments; linked invariants and exclusions; workflow transitions; failure classes; and source spans. It is deliberately marked unfiltered, current-state-free, and non-executable. It is not a browser artifact, an authorization decision, an agent capability view, or a preflight response.

`ui.json` is UI manifest v2 derived exclusively from operation manifest v2. It describes action fields, query filters and result tables, entity fields, enum options, workflow states and transitions, typed presentation hints, declared errors, query bounds, and humanized default labels. Stable semantic IDs are its binding keys. It is deliberately framework-neutral and does not claim caller authorization, invent entity option sources, or prescribe components.

`provenance.json` records compiler version, generator profile, model and IR identity, and the role and SHA-256 content hash of every other generated artifact. It omits wall-clock timestamps and its own recursive hash, so identical compilation inputs remain byte-for-byte deterministic.

The PostgreSQL backend emits:

- roles and ownership;
- direct-login and shared-gateway identity bindings;
- entity tables, foreign keys, enum checks, annotations, invariants, and temporal exclusion constraints;
- initial-state and legal-edge workflow triggers;
- internal model-version, source-hash, migration-kind, and reviewed-plan-hash history;
- `SECURITY DEFINER` action functions;
- pure authenticated `SECURITY DEFINER` action-applicability functions generated from the same decision plan;
- `SECURITY DEFINER` query functions with fail-closed filters and bounded JSON-array results;
- execute-only application grants with no direct entity-table access;
- example-only deterministic seed data;
- idempotent administrative upgrades for the 0.12 gateway and 0.17 applicability boundaries.

The generated TypeScript clients expose only declared actions, queries, and action applicability. They have no generic table or mutation API. Caller identity is not an input field.

- `typescript/browser.ts` is the browser-safe entry point. Its HTTP client sends JSON to stable-ID execution and applicability routes, and its UI executor keeps assessment separate from execution. It contains no SQL, database adapter, Node.js, or PostgreSQL contract.
- `typescript/ui.ts` embeds the readonly UI manifest and exports operation-ID-indexed input/result types, structural workflow availability, target-binding transition types, and fail-closed executors.
- `typescript/http-server.ts` authenticates bearer context, validates exact closed input and output objects, enforces query result bounds, dispatches stable operation IDs, maps RFC 9457 problems, and can bridge to an existing caller-bound generated database client.
- `typescript/gateway.ts` is a server-only shared-pool adapter. It binds verified issuer/subject claims for one transaction and never accepts a ModelLang principal ID.
- `typescript/client.ts` remains the server-side PostgreSQL client. It never forwards caller identity as a SQL argument; the database resolves it through the authenticated session boundary.

Query methods return typed entity arrays. Generated workflow metadata exposes lifecycle edges without creating a generic mutation surface. Authentication, PostgreSQL exclusion, and workflow failures cross HTTP as typed `AuthenticationError`, `ConflictError`, and `TransitionError` values.

Generated values are equally absent from create assignments and public inputs. For example:

```modellang
id: UUID @id @generated(uuid) @immutable;
createdAt: DateTime @generated(now) @immutable;
```

PostgreSQL creates both values inside the action transaction, and the returned typed entity includes them.

Each generated subtree contains `model.mmd`, `enforcement.json`, and `enforcement.md`, making the relationship between declarations and executable enforcement visible.

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
});
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

The ID is semantic identity; the name is an editable source, API, and physical label. `assign-ids` adds missing IDs to enums, members, entities, fields, invariants, exclusions, actions, queries, workflows, and transitions without changing existing IDs. Audit rows store stable action IDs, so an action rename does not split its audit history.

The migration command compares a released IR with current source exclusively by ID. ModelLang 0.10 plans new enums and members, new entities, nullable or default-backed fields, actions, queries, workflows, and workflow transitions. It also retains transactional renames for tables, columns, invariant constraints, temporal-exclusion constraints, and action/query functions.

The separate `semantic-diff` command is non-mutating and broader than migration planning. It reports all detected identity, structure, validation, authorization, query-visibility, lifecycle, effect, and persistence changes as additive, restrictive, expansive, breaking, or requiring review. Semantic diff v2 deliberately leaves authority with the separate guarded migration planners and marks predicate changes as review when logical implication cannot be proven.

Every migration checks the owner-controlled `schema_migrations` history against the previous IR's model ID, version, and source hash before changing anything. Structural DDL, workflow refreshes, the complete current action/query boundary, grants, and the new history record are applied in one transaction. A repeated or out-of-order migration fails with `ML_MIGRATION_BASELINE`.

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

The 0.10 safe planner continues to refuse removals, existing semantic changes, required fields without defaults/generation, data-dependent unique additions, enum-member value migration, and new invariants/exclusions on populated entity types. In 0.17, the supported subset of those changes can proceed only through the unchanged reviewed plan; unsupported transformations still fail closed rather than becoming compiler guesses.

## Explicit language semantics

- Entity equality is identity equality. `actor == request.requester` compares the two `User` primary keys, never every field on the two rows. The canonical IR marks this as `entityIdentity`, and PostgreSQL lowers it to UUID comparison.
- `caller actor: User` is semantic context, not a user-supplied action or query argument. It is omitted from both the generated SQL and TypeScript callable signatures. A direct login resolves through the owner-controlled `session_user` binding; a gateway transaction resolves through an owner-controlled `{issuer, subject}` binding.
- A `workflow` targets one required stored enum field, declares its initial state, and binds each legal edge to one update action. The compiler verifies that the action has a named source-state requirement and writes the declared destination, rejects undeclared state writes, and requires every enum state to be reachable.
- PostgreSQL workflow triggers require initial-state inserts and reject skipped or otherwise undeclared update edges. They are durable state-shape backstops; transition authorization, locking, assignments, and auditing remain explicit in the bound generated action.
- Added fields on existing entities must be nullable or have a constant/database-generated default. Added enum members refresh existing constraints, and added workflow edges replace the trigger function without weakening its initial-state or edge checks.
- Migration history is an internal enforcement boundary. Application roles cannot read or edit it, and the target version is recorded only if the full migration commits.
- `Money<USD>` is an exact nominal type, distinct from `Money<EUR>`, `Decimal`, and JavaScript numbers. Currency literals are explicit (`USD 10000`), PostgreSQL stores exact `numeric` values behind profile constraints, and TypeScript uses `{ currency: "USD", amount: "10000.00" }`.
- `@generated(uuid)` and `@generated(now)` are valid only on required `UUID` and `DateTime` stored fields respectively. Actions cannot assign them. PostgreSQL supplies qualified column defaults and returns the values from the same create statement.
- Generated fields are implicitly immutable. `@immutable` also prevents update effects from assigning ordinary stored fields while still allowing their explicit initial assignment during creation.
- A query declares one source entity, query-level authorization, a per-row `where` policy, a required direct ordering field, and a fixed limit from 1 through 1000. The compiler adds ascending primary-key order as a deterministic tie-breaker. Authorization and filtering both use `IS TRUE`, so false and SQL unknown fail closed.
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
- Principal bindings are provisioned only through a trusted administrative path.
- The host cryptographically verifies issuer/subject credentials before constructing a gateway executor.
- The shared gateway database credential is confined to trusted server code and never reaches a browser or caller.
- Database authentication is already trustworthy; this PoC does not solve password, secret, host, or infrastructure compromise.

Both principal-binding tables are owned by `modellang_owner`; runtime roles cannot read or modify them. Direct identity uses `session_user`, not `current_user`, because a security-definer function changes `current_user` to its owner. Gateway identity is accepted only for an explicit member of `modellang_gateway`, activated transaction-locally, and discarded by commit or rollback. An unbound session fails before authorization.

Gateway action audits preserve the database principal, resolved model principal, issuer, and subject. Direct-login audit rows keep issuer and subject null. Ordinary app roles cannot override their direct binding by setting gateway-shaped PostgreSQL configuration values.

Application roles can use the model schema and execute generated action and query functions. They cannot directly select, insert, update, delete, or truncate model tables; create objects in generated schemas; read principal bindings; or assume the owner role. PostgreSQL superusers, object owners, and migration authorities remain outside the guarantee by design.

## Concurrency and fail-closed rules

The compiler discovers every statically identifiable entity row read by guards and effects. Update targets use `FOR UPDATE`; other mutable dependencies, including the authenticated principal, use `FOR SHARE`. Locks are acquired in canonical entity/source order before any guard or effect expression is evaluated, and evaluation uses only records returned by lock-bearing queries.

Authorization, preconditions, and invariants succeed only when their SQL value is exactly true. Each boundary is emitted with `IS TRUE`; false and SQL unknown both reject the operation. Optional enum and min/max field constraints explicitly permit null before applying their value constraint.

Read queries evaluate authorization before scanning result rows, apply their row policy inside the generated function, and return one deterministically ordered bounded array. They intentionally use no result-row locks because no authorization-dependent mutation follows the read.

The integration suite proves concurrency with transaction barriers and observed `pg_stat_activity` lock waits:

- a request amount changed while approval waits is re-read and re-authorized;
- a manager role set changed while approval waits is re-read and re-authorized;
- two concurrent approvals yield exactly one success, one failed precondition, and one audit record.
- a concurrent overlapping reservation waits on PostgreSQL’s exclusion constraint, then exactly one reservation and audit record survive.

## Tests

Run compiler and backend tests without PostgreSQL:

```bash
npm run test:unit
```

Run live database tests after `npm run db:up`:

```bash
npm run test:integration
```

The full suite validates parsing and spans, additive migration planning and live row preservation, baseline-history rejection, workflow/action contracts and direct-SQL lifecycle backstops, stable-ID assignment and validation, exact money profiles and cross-currency rejection, generated-value authority and immutability, deterministic rename planning, operation/UI/semantic/provenance schemas, semantic change classification, workflow availability and target binding, duplicate and unknown declarations, caller rules, type/null semantics, query policies, deterministic ordering and limits, temporal exclusions, disallowed traversal, action assignments, lock planning, deterministic output, artifact hashes, callable identity omission, execute-only privileges, read isolation, typed errors, auditing, invariants, conflicts, and real races.

## Deliberate PoC boundaries

- Enums use text plus named `CHECK` constraints for deterministic DDL and explicit migration control.
- Expressions support literals, paths, Boolean operators, and comparisons only. Money is exact and currency-typed, but arithmetic, allocation, tax, exchange, rounding, string operations, aggregates, and computed values require explicit future semantics.
- Direct per-user PostgreSQL logins remain a supported adapter. The generated 0.12 gateway is the shared-pool adapter and accepts only verified issuer/subject claims, never arbitrary principal IDs.
- Lock planning is sound for finite entity rows identified by action parameters. Temporal `noOverlap` is the one supported predicate rule and uses a PostgreSQL exclusion constraint. General collections, aggregates, absence checks, and other phantom-sensitive rules remain unstable.
- Queries intentionally omit joins, traversal, projections, aggregates, optional parameters, caller-controlled sorting and limits, pagination, full-text search, and read-audit policy in 0.3.
- Enum sets intentionally omit literals, defaults, API parameters, equality, ordering, algebraic operations, incremental mutation, and role inheritance in 0.4.
- Workflows intentionally omit parallel or hierarchical states, cross-entity lifecycles, wildcard edges, entry/exit hooks, timers, asynchronous events, compensation, and framework-specific workflow controls.
- Safe evolution intentionally omits removals, type/default/generation/mutability changes, arbitrary backfills, enum stored-value transformations, workflow rewrites, online DDL scheduling, down migrations, and distributed deployment orchestration in 0.10.
- The 0.12 gateway profile intentionally leaves token formats and verification libraries, trusted issuer/audience policy, binding administration, credential rotation, cookie/CSRF/CORS policy, caching, retries, idempotency keys, package publication, deployment, and observability to the host.
- UI manifest v2 intentionally omits framework components, layout, localization, entity option queries, authorization visibility/preflight, generic CRUD, pagination controls, optimistic concurrency, and client-side validation policy. Alternate transports and AI/MCP generation remain deferred consumers of declared operations.
- Engineering semantic manifest v1 is intentionally a trusted static artifact, not an authorization-filtered capability view. Applicability, decision explanations, freshness, idempotency, recovery, events, external operations, extensions, target capability profiles, and agent/MCP generation remain future contracts.
- Elevated PostgreSQL authorities can bypass the boundary and are intentionally out of scope.

The normative 0.15 language is in [spec/0.15/LANGUAGE.md](./spec/0.15/LANGUAGE.md), with its [semantic closure, provenance, and change-analysis contract](./spec/0.15/SEMANTIC_CLOSURE.md), [conformance requirements](./spec/0.15/CONFORMANCE.md), and [unstable boundaries](./spec/0.15/UNSTABLE.md). The [0.14 workflow application boundary](./spec/0.14/WORKFLOW_APPLICATIONS.md), [0.13 UI manifest](./spec/0.13/UI_MANIFEST.md), [0.12 gateway identity profile](./spec/0.12/GATEWAY_IDENTITY.md), [0.11 transport](./spec/0.11/TRANSPORT.md), and [0.10 safe evolution rules](./spec/0.10/SAFE_EVOLUTION.md) remain normative where 0.15 does not replace them. The repository edition of [The Semantic Model Layer whitepaper](./docs/whitepaper/THE_SEMANTIC_MODEL_LAYER.md) records demonstrated, partial, and research-stage capabilities. The original proof-of-concept requirements remain archived in [ModelLang_PoC_Spec_Revision_2.md](./ModelLang_PoC_Spec_Revision_2.md).
