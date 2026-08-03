# ModelLang 0.36 conformance

An implementation conforms when it satisfies 0.35 conformance and:

1. parses optional terminal `audit reads;` after a query's optional pagination clause;
2. records opt-in transactional audit mode and a deterministic query-contract revision in IR25 without adding a callable input or changing output cardinality;
3. appends evidence only after identity resolution, validation, authorization, row filtering, conditional disclosure, ordering, pagination, and exact result construction succeed;
4. writes evidence in the same transaction as the query, so commit makes it durable and rollback removes it; failed, denied, malformed, or unbound invocations append none;
5. records query and model identity, model version and source hash, query revision, database and model principal identity, exact gateway issuer/subject attribution where applicable, result count, selected sort profile, and whether the request continued a cursor;
6. binds callable inputs, selected sort profile, and any cursor into a canonical SHA-256 request hash and binds the exact returned JSON value into a SHA-256 response hash;
7. stores no request payload, raw filter, raw cursor, response payload, result row, or disclosed field value in the audit table;
8. keeps the audit table private from application, gateway, dispatcher, consumer, recovery, and failure-operation roles and publishes no public audit-read API;
9. exposes only static read-evidence metadata through operation, OpenAPI, UI, semantic, enforcement, and provenance artifacts;
10. includes audit mode in the query revision, thereby invalidating paginated cursors when the audit guarantee changes;
11. classifies adding or removing transactional read evidence as a breaking operational contract change with persistence risk;
12. emits a baseline-checked, downgrade-guarded, idempotent `020_upgrade_0_36.sql` that advances runtime profile 36 without fabricating historical evidence;
13. accepts IR9 through IR24 as unaudited evolution baselines without fabricating evidence guarantees or rows;
14. emits IR25, operation manifest v11, capability manifest v10, UI manifest v11, semantic manifest/profile v17, semantic diff v18, generator profile `/20`, and private runtime profile 36; and
15. preserves all locked earlier safety, privacy, deterministic generation, filtering, sorting, pagination, disclosure, evolution, and privilege semantics.
