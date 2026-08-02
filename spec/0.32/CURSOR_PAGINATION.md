# Cursor pagination

## Declaration and result

```modellang
query reservationsForResource(caller actor: User, resource: Resource)
  returns ReservationSummary from Reservation as reservation {
  authorize true;
  where reservation.resource == resource;
  orderBy reservation.startsAt asc;
  limit 25;
  paginate cursor;
}
```

The generated callable input adds optional `cursor: String`. The result changes from a projection array to the closed page object `{ items: Projection[], nextCursor: String? }`. `items` contains at most the authored limit. The caller cannot select a limit, offset, page number, order field, or direction. An omitted cursor starts the traversal; `nextCursor == null` marks completion.

Queries without `paginate cursor;` retain their existing array input/output ABI.

## Ordering and continuation

Pagination uses the query's required direct ordering field and the existing ascending primary-key identity tie-breaker. The database reads at most `limit + 1` matching rows, returns the first `limit`, and constructs a cursor from the final returned row only when another row exists.

Ascending continuation admits rows with a greater sort value or an equal sort value and greater identity. Descending continuation admits rows with a lesser sort value or an equal sort value and greater identity. Offset pagination is not generated.

Each page executes under its own PostgreSQL statement snapshot. Cursor pagination guarantees deterministic continuation relative to the bound key, not a frozen multi-request snapshot; concurrent inserts or updates may change later-page membership.

## Opacity, binding, and errors

Cursor v1 is canonical JSON encoded as unpadded base64url. It is opaque to callers but is not a secret, signature, delegated capability, or authorization proof. It binds:

- cursor format version;
- model stable ID, model version, and source hash;
- query stable ID and deterministic semantic revision;
- authored order field and direction;
- authenticated principal and all callable filter inputs;
- the last sort value and identity.

The database rejects invalid encoding, shape, types, bounds, or key values as `ML_VALIDATION:cursor:<query-id>`. A structurally valid cursor with any mismatched model, query, ordering, principal, or filter binding is stale and raises `ML_STALE:cursor:<query-id>`.

## Authority

Every page independently resolves authenticated identity and callable entity inputs and re-evaluates query authorization and row policy. The cursor never bypasses those checks. Application roles retain execute-only query access and cannot read model tables directly.

## Evolution

Adding, removing, or changing pagination changes the callable input and closed result envelope and is breaking. Model source hash and query revision binding invalidate older cursors explicitly. IR20 queries normalize as unpaginated; no pagination contract or cursor revision is invented.
