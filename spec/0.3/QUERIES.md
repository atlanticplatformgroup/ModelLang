# ModelLang 0.3 — Authenticated Query Semantics

Status: normative design contract for the 0.3 reference compiler.

This document defines the first ModelLang read boundary. It extends the 0.2 core without changing action, identity, invariant, snapshot, or temporal-exclusion semantics.

## Purpose

Application principals must not receive unrestricted table `SELECT`. A model declares the bounded row collections an authenticated caller may obtain, and the compiler generates the only application-readable PostgreSQL functions.

## Surface form

```modellang
query myRequests(
  caller actor: User
) from PurchaseRequest as request {
  authorize true;
  where request.requester == actor;
  orderBy request.id asc;
  limit 100;
}
```

A query has:

- exactly one authenticated entity parameter marked `caller`;
- zero or more required scalar, enum, or entity parameters;
- one source entity and one row alias;
- exactly one query-level authorization rule;
- exactly one row-filter rule;
- exactly one deterministic ordering;
- exactly one compile-time result limit.

The result type is an ordered array of the source entity.

## Caller and parameters

Caller semantics are identical to actions. The caller is part of the semantic signature but absent from SQL and TypeScript callable inputs. PostgreSQL resolves it from `session_user` through the owner-controlled principal-binding table.

All non-caller parameters are required in 0.3. Entity parameters are callable UUIDs and must identify an existing row; missing entities fail with the generated `NotFoundError`.

## Authorization and row filtering

`authorize` is evaluated once before reading result rows. It may reference query parameters and direct fields of entity parameters, but it may not reference the row alias.

`where` is evaluated independently for each source row. It may reference:

- the row alias;
- query parameters;
- direct fields of entity parameters;
- qualified enum members and literals.

Relationship traversal remains unsupported. Entity comparisons are primary-key identity comparisons.

Authorization succeeds only when exactly true. A row is returned only when its `where` result is exactly true. False and nullable unknown both fail closed.

## Ordering and limits

`orderBy` names one required direct source-row field and specifies `asc` or `desc`. The compiler adds source primary-key ascending order as a deterministic tie-breaker.

The ordering field may be `String`, `Int`, `Decimal`, `Boolean`, `UUID`, `DateTime`, an enum, or an entity reference. Optional ordering fields are rejected in 0.3 so null placement has no implicit semantics.

`limit` is an integer literal from 1 through 1000. It is compiled into the generated function and cannot be increased by a caller.

Cursor pagination, caller-supplied limits, offsets, and continuation tokens are explicitly unstable.

## PostgreSQL enforcement

Each query compiles to a schema-qualified `SECURITY DEFINER` function with:

- a fixed `search_path` of `pg_catalog, pg_temp`;
- no caller UUID parameter;
- `session_user` principal resolution;
- existence checks for entity parameters;
- fail-closed query authorization;
- fail-closed row filtering;
- deterministic ordering and bounded result count;
- a `jsonb` array result.

Read functions do not lock result rows. PostgreSQL statement-level MVCC provides one consistent read snapshot; unlike actions, queries perform no authorization-dependent mutation after the read.

Successful reads do not write action-audit records in 0.3. Read-audit policy is an explicit future decision.

## Privilege boundary

`modellang_app` and application login roles receive no direct `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` privileges on entity tables. They receive model-schema usage and execute privileges only on generated action and query functions.

This means the query’s `where` rule is an enforcement boundary, not an application convention.

## Generated client

The TypeScript client receives one method per query:

```ts
const requests = await client.myRequests({});
```

The return type is `Promise<PurchaseRequest[]>`. The input type contains only non-caller parameters, and extra runtime properties are never forwarded to SQL.

## 0.3 non-goals

- joins or relationship traversal;
- aggregates, grouping, or distinct projections;
- selected-field projections;
- optional parameters;
- caller-controlled sorting or limits;
- cursor or offset pagination;
- full-text or fuzzy search;
- general collection expressions;
- read-audit logging;
- HTTP or frontend generation.
