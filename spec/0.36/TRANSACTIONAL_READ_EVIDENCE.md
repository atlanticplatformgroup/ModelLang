# Transactional read evidence

## Declaration and scope

A query opts into committed read evidence with a terminal clause:

```model
query myRequests(caller actor: User)
  returns RequestSummary from PurchaseRequest as request {
  authorize true;
  where request.requester == actor;
  orderBy request.id asc;
  limit 100;
  audit reads;
}
```

`audit reads;` follows `paginate cursor;` when pagination is present. It introduces no callable parameter, response envelope, header, field, or alternate result type. Queries without the clause append no read evidence.

The guarantee applies to successful committed query invocations. Identity resolution, input validation, query authorization, row policy, conditional disclosure, static ordering, fixed limiting, cursor validation, and result construction all complete before the evidence insert. Any failure appends nothing. The insert participates in the caller's PostgreSQL transaction: commit preserves both the invocation's evidence and all transaction state, while rollback preserves neither.

## Private evidence record

Each record contains:

- stable query ID and deterministic query-contract revision;
- model ID, model version, and source hash;
- database principal and resolved model principal UUID;
- gateway issuer and subject only when gateway identity supplied them;
- canonical request SHA-256 and exact response SHA-256;
- returned item count, selected sort-profile name, and a Boolean indicating cursor continuation; and
- database transaction timestamp.

The canonical request value contains stable query identity and revision, callable inputs keyed by stable parameter ID, selected sort profile, and the opaque cursor when present. Entity identifiers, exact money, decimals, enum sets, nulls, and scalars use the same canonical JSON encodings already used for query and cursor identity. The evidence table stores only the resulting hash, never that constructed value.

The response hash is computed over the exact final PostgreSQL `jsonb` value returned by the query, after redaction and pagination-envelope construction. It therefore binds required null-redaction keys, item order, and any next cursor without copying them into audit storage.

## Privacy and authority

The generated `query_audit` table is in the internal schema. Application and every generated operational role have no table access. No OpenAPI endpoint, TypeScript audit client, UI operation, capability, event, or agent surface can read it. Operation, OpenAPI, UI, and engineering semantic artifacts publish only the static fact that a query is transactionally audited and the hash/revision profile.

Evidence grants no query authority and cannot widen rows or fields. It contains no raw input, filter, cursor, response, result row, or disclosed field value. The database owner remains trusted and can access or alter private state; this profile is not a cryptographic signature or external attestation system.

## Revision, evolution, and migration

The query revision covers parameters, source and return projection, authorization, row policy, conditional disclosure, ordering, sort profiles, fixed limit, pagination, and audit mode. Audited evidence records the revision. Adding audit mode to a paginated query changes that revision, so an older cursor is stale.

Adding or removing `audit reads;` is breaking because it changes a committed evidence and operational-retention guarantee even though the callable and output shapes remain unchanged. Released IR9 through IR24 baselines normalize to no read evidence.

Fresh installation creates private runtime profile 36. `020_upgrade_0_36.sql` creates the table idempotently, regenerates query functions, and advances the monotonic runtime ledger. It does not synthesize evidence for earlier reads and refuses to deploy over a newer runtime profile.
