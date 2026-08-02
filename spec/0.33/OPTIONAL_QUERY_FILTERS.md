# Optional authored query filters

## Declaration

Only a non-caller query parameter may append `?`:

```model
query reservationsForResource(
  caller actor: User,
  resource: Resource,
  startsAtOrAfter: DateTime?
) returns ReservationSummary from Reservation as reservation {
  authorize true;
  where reservation.resource == resource
    and (startsAtOrAfter == null or reservation.startsAt >= startsAtOrAfter);
  orderBy reservation.startsAt asc;
  limit 2;
  paginate cursor;
}
```

Action, policy, and consumer parameters remain required. A caller parameter cannot be optional. The supported value types are the same scalar, enum, exact-money, and entity-reference types already accepted for query parameters.

## Null semantics

At JSON boundaries, an omitted optional property and an explicit `null` represent the same nullable query value. Generated TypeScript inputs use `property?: T | null`; PostgreSQL receives SQL `NULL`. A present non-null value must satisfy the existing exact type contract.

The compiler performs no implicit rewrite such as `parameter IS NULL OR predicate`. The author must compare the optional parameter with `null` and must state every predicate that should apply when it is present. Ordinary SQL three-valued logic remains fail-closed because query authorization and row policy boundaries require `IS TRUE`.

For optional entity references, PostgreSQL skips the entity load when the input is null. A present UUID must resolve to an entity row or the query fails closed under its authorization rule. Optional exact-money validation is skipped only for null and remains exact for present values.

## Derived contracts

IR22 records optionality on query parameters and propagates nullability through direct parameter values and entity field access. Operation and semantic manifests carry `optional: true`; OpenAPI omits the property from `required` and permits null; HTTP accepts omission or null but rejects unknown properties and invalid present values; UI descriptors use `required: false` and `nullable: true`.

Cursor pagination fingerprints the complete callable input map, including JSON null for an omitted or explicit-null filter. A cursor issued for null input is stale when reused with a concrete filter, and vice versa. The cursor remains non-authoritative and every page re-evaluates current identity, authorization, entity loads, and row policy.

Changing query parameter optionality changes the callable operation shape and is classified as breaking. Automatic migration planning does not infer that a changed read predicate or optionality is deployment-safe.
