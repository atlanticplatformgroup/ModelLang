# Named read projections

## Declaration and use

A projection names a closed JSON result shape over one entity:

```modellang
projection RequestSummary @stableId("prj_70d694c9a0a274dc79c6168e47d25968") from PurchaseRequest {
  id @stableId("pfd_71d694c9a0a274dc79c6168e47d25968");
  amount @stableId("pfd_73d694c9a0a274dc79c6168e47d25968");
  status @stableId("pfd_74d694c9a0a274dc79c6168e47d25968");
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

The query source must equal the projection source. Query cardinality is always `many`; source syntax therefore does not append `[]` to the projection name.

## Selection and encoding

A projection must select at least one direct source field. Each selected name must exist exactly once. Collections, including enum sets, are not projectable in 0.30. Scalars, enums, exact money, entity references encoded as UUIDs, generated UUID/DateTime fields, and supported non-collection snapshots retain their canonical entity-field JSON encoding.

The output key is the current selected source-field name. Aliases and traversal are not supported. Every selected key is required in the closed object. An optional stored value is encoded as JSON `null`, not as an omitted key. Field declaration order has no semantic compatibility meaning.

Query predicates and ordering may read direct source fields that the projection does not select. Those fields remain hidden. PostgreSQL must construct selected JSON directly and must not serialize a complete row and redact it later.

## Authority

A projection defines shape only. It contains no authorization, row policy, ordering, limit, freshness, or capability semantics. Every query independently owns those rules even when multiple queries reuse one projection.

Projection declarations are valid only as query result types. They are invalid as entity fields, policy/action/query inputs, action outputs, event payloads, or consumer payloads and outputs.

## Identity and evolution

Projection identity uses `prj_` stable IDs and projection-field identity uses independent `pfd_` stable IDs. An IR projection member also records its selected source-field ID.

Adding an unused projection or a new query is additive. A stable projection rename is identity-preserving additive, and member reordering has no semantic effect. Changing a reachable projection source, member set, output name, selected source field, type, or nullability is breaking. Changing an existing query result projection is breaking.

IR9–IR18 evolution inputs retain their historical entity result internally as `legacyEntity`. No projection identity is fabricated. Moving such a query to an explicit IR19 projection produces a breaking query-output change and an exact disclosure-set delta; the automatic-safe planner rejects it and the reviewed planner requires acknowledgement.

## Derived contracts

IR19 stores all projections and each query's `returnProjectionId`. Operation manifest v5 publishes only query-reachable projection descriptors. OpenAPI, HTTP output validation, generated TypeScript clients, and UI manifest v5 use those descriptors as the single public result contract.

Engineering semantic manifest v11 stores every projection and distinguishes a query's source `readSet` from its `disclosureSet`. Enforcement evidence and Mermaid output likewise distinguish reading source rows from disclosing selected fields.
