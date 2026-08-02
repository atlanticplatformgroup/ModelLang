# Authored sort profiles

## Declaration

A query may declare up to 16 named alternate orderings after its required default `orderBy` clause and before `limit`:

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
  sort latestFirst: reservation.startsAt desc;
  sort endingSoonest: reservation.endsAt asc;
  limit 2;
  paginate cursor;
}
```

The required `orderBy` clause defines the profile named `default`. The name `default` is therefore reserved and cannot be declared. Profile names must be unique within the query. Each profile selects one required direct field of the query source alias and an `asc` or `desc` direction. Optional fields, paths through another alias, traversal, expressions, multiple authored keys, and runtime-defined ordering are invalid.

The compiler always appends the source entity identity in ascending order as the deterministic tie-breaker. This tie-breaker cannot be selected or reversed by a caller. Profile declaration order may be preserved for presentation, but it is not part of ordering identity or semantic compatibility.

## Callable contract

A query with at least one named profile gains an optional `sort` input whose exact values are `default` and the declared profile names. Omission is equivalent to `default`. A model cannot declare its own query parameter named `sort` on such a query. Queries without named profiles retain their previous callable contract and do not expose a `sort` input.

Generated TypeScript uses a string-literal union. OpenAPI and HTTP use a closed enum and reject unknown values with `ML_VALIDATION:sort-profile:<query-id>`. Operation and UI manifests publish stable profile IDs, names, field IDs, directions, and the ascending identity tie-breaker. The profile contract grants no new query authority and does not disclose the ordering field unless that field is independently selected by the result projection.

## PostgreSQL and cursor behavior

PostgreSQL generation is static. Every authored field and direction becomes a compile-time `CASE` branch in the generated function; profile input is never interpolated into SQL and no dynamic SQL is emitted. Authorization and the row policy are evaluated exactly as for the default order.

For cursor pagination, keyset comparison follows the selected profile direction and then ascending identity. Cursor payloads record the selected order-field identity and direction. The cursor input fingerprint also includes the selected profile, so a cursor issued under one profile is stale under every other profile, including `default`. Every continued page re-resolves the principal and re-evaluates authorization and row visibility.

## Evolution

Profile identity is derived from the stable query identity and authored profile name. Adding a new named profile is additive because existing callers retain `default` and all prior names. Removing a profile, or changing its field or direction, is breaking. For paginated queries the complete ordered profile set also participates in the cursor revision, invalidating cursors across a changed profile contract.

Released IR9 through IR22 baselines normalize to no named profiles. Evolution does not fabricate profile declarations or runtime inputs for historical models.
