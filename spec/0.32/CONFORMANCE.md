# ModelLang 0.32 conformance

An implementation conforms when it satisfies 0.31 conformance and:

1. parses optional `paginate cursor;` only after the fixed query limit;
2. leaves unpaginated query array contracts unchanged;
3. adds only optional cursor input and a closed `{ items, nextCursor }` page result for opted-in queries;
4. retains the authored limit as the fixed page bound and accepts no caller-controlled limit, order, offset, or page number;
5. orders by the authored required field plus ascending identity and uses keyset continuation without `OFFSET`;
6. reads at most `limit + 1` rows, returns at most `limit`, and emits a cursor only when another row exists;
7. binds cursor v1 to model ID/version/source hash, query ID/revision, ordering, principal, filter inputs, sort value, and identity;
8. rejects malformed cursors with `ML_VALIDATION:cursor:<query-id>` and mismatched bindings with `ML_STALE:cursor:<query-id>`;
9. re-resolves identity and inputs and re-evaluates authorization and row policy on every page;
10. treats cursors as opaque non-authority transport state;
11. emits consistent page contracts through PostgreSQL, TypeScript, operation manifest, OpenAPI, HTTP, UI, and engineering semantics;
12. classifies pagination contract changes as breaking and invalidates cursors across relevant source/query changes;
13. accepts IR20 queries as unpaginated without fabricating cursor identity;
14. emits IR21, operation manifest v7, capability manifest v6, UI manifest v7, semantic manifest/profile v13, semantic diff v14, and generator profile `/16`; and
15. preserves all locked earlier safety, privacy, deterministic generation, evolution, and privilege semantics.
