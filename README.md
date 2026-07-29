# ModelLang 0.4 reference compiler

ModelLang compiles a small domain ontology into a PostgreSQL enforcement boundary. The compiler produces a typed canonical IR, constrained tables, authenticated actions, bounded authenticated queries, enum-set permissions, a typed TypeScript client, a Mermaid graph, and a rule-to-enforcement map.

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
```

After `npm run build`, the executable is available as:

```bash
node dist/src/cli.js check examples/procurement.model
```

`build` writes to a temporary sibling directory and replaces the requested output only after every compiler stage and backend succeeds.

## What is generated

Each model has a generated subtree: `generated/procurement/` and `generated/reservations/`. Its `model.ir.json` is the only backend input. IR version 4 retains qualified semantic IDs, typed expression trees, nullability, source spans, caller metadata, callable parameters, canonical lock plans, snapshot storage semantics, enum sets and membership, temporal exclusions, query policies, deterministic ordering, and result limits. Both committed subtrees are golden fixtures.

The PostgreSQL backend emits:

- roles and ownership;
- entity tables, foreign keys, enum checks, annotations, invariants, and temporal exclusion constraints;
- `SECURITY DEFINER` action functions;
- `SECURITY DEFINER` query functions with fail-closed filters and bounded JSON-array results;
- execute-only application grants with no direct entity-table access;
- example-only deterministic seed data.

The generated TypeScript clients expose only declared actions and queries. They have no generic table or mutation API. Caller identity is not an input field and is never forwarded as a SQL argument. Query methods return typed entity arrays. PostgreSQL exclusion failures map to typed `ConflictError`.

Each generated subtree contains `model.mmd`, `enforcement.json`, and `enforcement.md`, making the relationship between declarations and executable enforcement visible.

## Explicit language semantics

- Entity equality is identity equality. `actor == request.requester` compares the two `User` primary keys, never every field on the two rows. The canonical IR marks this as `entityIdentity`, and PostgreSQL lowers it to UUID comparison.
- `caller actor: User` is semantic context, not a user-supplied action or query argument. It is omitted from both the generated SQL and TypeScript callable signatures, then resolved from `session_user` through the owner-controlled principal-binding table.
- A query declares one source entity, query-level authorization, a per-row `where` policy, a required direct ordering field, and a fixed limit from 1 through 1000. The compiler adds ascending primary-key order as a deterministic tie-breaker. Authorization and filtering both use `IS TRUE`, so false and SQL unknown fail closed.
- Query entity parameters are callable UUIDs but must resolve to existing rows. Query functions use a statement-level MVCC snapshot and do not lock result rows or write action-audit records.
- Invariants are exactly directional as written. The Procurement model uses `approval_fields_match_status`, which requires approval fields to be both populated exactly when a request is `APPROVED` and null for every other status.
- `@snapshot` is valid on stored scalar, enum, and enum-set entity fields and marks a point-in-time audit copy. The compiler never auto-populates it: an action must explicitly assign either `null` or a compatible direct field value such as `actor.roles`. That value is copied into the row; later changes to the source field do not propagate.
- `PurchaseRequest.amount` uses `@minExclusive(0)`, so zero is never valid in storage. `openRequest` retains `positive_amount` as an action-level, named guard and clearer diagnostic; the two layers are intentionally defense in depth.
- `Set<Role>` stores multiple duplicate-free enum members. `Role.EMPLOYEE in actor.roles` is a typed membership policy that lowers to fail-closed database enforcement. Managers and finance users in the canonical seed are also employees, so they may open requests while retaining their approval permissions.
- Enum sets are unordered domain values represented as constrained PostgreSQL `text[]` and generated TypeScript enum arrays. Unknown, null, and duplicate members are rejected by named constraints.
- `noOverlap(resource, startsAt, endsAt)` defines required half-open intervals `[start, end)`. Adjacent reservations are legal; overlapping intervals for the same entity identity are rejected atomically. The PostgreSQL backend emits a strict interval check and GiST exclusion constraint.

## Security guarantee and trust boundary

For a session authenticated as a provisioned application login possessing only `modellang_app` privileges, every generated state change is attributed to the model principal bound to `session_user` and constrained by generated authorization, preconditions, invariants, deterministic row locks, and table privileges.

The proof relies on these operational assumptions:

- `modellang_owner` is `NOLOGIN`.
- Application processes never connect as a superuser, `modellang_owner`, or a migration role.
- Application logins are not members of `modellang_owner` and cannot `SET ROLE` into it.
- Migration credentials are isolated from normal application runtime credentials.
- Principal bindings are provisioned only through a trusted administrative path.
- Database authentication is already trustworthy; this PoC does not solve password, secret, host, or infrastructure compromise.

The principal-binding table is owned by `modellang_owner` in an internal schema inaccessible to application roles. Action functions use `session_user`, not `current_user`, because a security-definer function changes `current_user` to its owner. An unbound session fails before authorization.

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

The full suite validates parsing and spans, duplicate and unknown declarations, IDs and annotations, caller rules, type/null semantics, query authorization and row policies, deterministic ordering and limits, DateTime ordering, temporal exclusion definitions, disallowed traversal, action targets and assignments, lock planning, deterministic IR/output, SQL null lowering, callable identity omission, execute-only privileges, cross-caller read isolation, cross-resource read isolation, typed client errors, auditing, invariants, half-open adjacency, conflicts, and real races.

## Deliberate PoC boundaries

- Enums use text plus named `CHECK` constraints for deterministic DDL and explicit migration control.
- Expressions support literals, paths, Boolean operators, and comparisons only. Arithmetic, string operations, aggregates, and computed values require explicit future semantics.
- One PostgreSQL login per demo user is the identity adapter. A production gateway may replace it only if callers still cannot choose arbitrary principal IDs.
- Lock planning is sound for finite entity rows identified by action parameters. Temporal `noOverlap` is the one supported predicate rule and uses a PostgreSQL exclusion constraint. General collections, aggregates, absence checks, and other phantom-sensitive rules remain unstable.
- Queries intentionally omit joins, traversal, projections, aggregates, optional parameters, caller-controlled sorting and limits, pagination, full-text search, and read-audit policy in 0.3.
- Enum sets intentionally omit literals, defaults, API parameters, equality, ordering, algebraic operations, incremental mutation, and role inheritance in 0.4.
- Elevated PostgreSQL authorities can bypass the boundary and are intentionally out of scope.

The normative 0.4 language is in [spec/0.4/LANGUAGE.md](./spec/0.4/LANGUAGE.md), with its [enum-set semantics](./spec/0.4/SETS.md), [grammar](./spec/0.4/GRAMMAR.ebnf), [conformance requirements](./spec/0.4/CONFORMANCE.md), and [unstable boundaries](./spec/0.4/UNSTABLE.md). The [0.3 language](./spec/0.3/LANGUAGE.md) remains normative where 0.4 does not replace it. The original proof-of-concept requirements remain archived in [ModelLang_PoC_Spec_Revision_2.md](./ModelLang_PoC_Spec_Revision_2.md).
