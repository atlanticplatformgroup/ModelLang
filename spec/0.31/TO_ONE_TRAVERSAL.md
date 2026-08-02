# Bounded to-one projection traversal

## Declaration

```modellang
projection UserSummary from User {
  id;
  name;
}

projection RequestSummary from PurchaseRequest {
  id;
  approvedBy: UserSummary;
}
```

`approvedBy` selects the `PurchaseRequest.approvedBy` source field and encodes its referenced `User` through `UserSummary`. Without `: UserSummary`, the same entity-reference field retains the 0.30 UUID encoding.

The selected field must be a non-collection entity reference. The nested projection source must be exactly the referenced entity. Unknown projections, scalar or collection traversal, mismatched sources, and projection dependency cycles are compile errors. Reverse traversal and inferred joins do not exist.

## Bounds and nulls

The projection dependency graph is authored statically and must be acyclic. Its finite transitive closure is the traversal bound; a caller cannot choose fields, paths, depth, sorting, limits, or nested query behavior.

Every projection key remains required. An optional reference produces either the complete nested closed object or JSON `null`. A required reference produces a non-null nested object. Nested optional fields follow their own projection contracts. Generated foreign keys prevent dangling references; traversal does not silently omit or redact missing targets.

## Authority and disclosure

The root query retains authentication, authorization, row policy, ordering, and result limit. A nested projection carries no independent authority and reusing it grants none. Naming it on a root projection member is an explicit disclosure decision for rows already admitted by the query.

PostgreSQL constructs nested JSON directly through a correlated primary-key lookup. It neither serializes complete source or related rows nor accepts caller-authored joins. Direct table access remains denied to application roles.

## Derived contracts

IR20 adds optional `nestedProjectionId` to a projection member. Operation manifest v6 publishes the transitive projection dependency closure reachable from queries and excludes unrelated projections. Nested OpenAPI properties reference closed projection schemas; generated TypeScript uses nested interfaces; HTTP validation recursively rejects missing, extra, or mistyped nested data; UI manifest v6 retains the same stable dependency ID.

Semantic manifest v12 records nested dependency edges. A query's read and disclosure sets include the transitive source entities, references, nested projection IDs, projection-member IDs, and selected source-field IDs. Mermaid output renders the dependency edge separately from the root query's row source.

## Evolution

Changing a stable member between direct UUID encoding and a nested projection, or changing its nested projection target, is breaking. Adding or removing members in a transitively query-reachable nested projection is also breaking. Automatic-safe migration computes transitive reachability and rejects those changes; reviewed migration may proceed only with the existing stable acknowledgement mechanism.

IR9 through IR18 retain historical implicit entity query output. IR19 projections without `nestedProjectionId` retain their direct-field meaning. No traversal identity is fabricated during evolution normalization.
