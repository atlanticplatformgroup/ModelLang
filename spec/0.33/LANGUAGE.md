# ModelLang 0.33 — Normative Language

Status: normative specification for the 0.33 reference compiler.

ModelLang 0.33 consists of the complete [ModelLang 0.32 language](../0.32/LANGUAGE.md) plus [optional authored query filters](./OPTIONAL_QUERY_FILTERS.md). A non-caller query parameter may append `?` to declare a nullable callable input. Omission and explicit null are equivalent at generated transport boundaries; filter behavior exists only where the author states it in the query expression.

Version 0.33 advances canonical IR to IR22, operation manifest to v8, capability manifest to v7, UI manifest to v8, engineering semantic manifest/profile to v14, semantic diff to v15, and generator profile to `postgresql-http-ui-optional-query-filters/17`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, traversal, pagination, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.33 differs, this version takes precedence.
