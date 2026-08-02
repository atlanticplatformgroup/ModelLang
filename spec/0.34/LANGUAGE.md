# ModelLang 0.34 — Normative Language

Status: normative specification for the 0.34 reference compiler.

ModelLang 0.34 consists of the complete [ModelLang 0.33 language](../0.33/LANGUAGE.md) plus [authored sort profiles](./AUTHORED_SORT_PROFILES.md). A query may declare a closed set of named alternate orderings after its required `orderBy` clause. Callers may select only `default` or one of those authored names; they cannot supply a field, direction, expression, limit, offset, or SQL fragment.

Version 0.34 advances canonical IR to IR23, operation manifest to v9, capability manifest to v8, UI manifest to v9, engineering semantic manifest/profile to v15, semantic diff to v16, and generator profile to `postgresql-http-ui-authored-sort-profiles/18`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, traversal, filtering, pagination, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.34 differs, this version takes precedence.
