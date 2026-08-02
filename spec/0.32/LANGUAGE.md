# ModelLang 0.32 — Normative Language

Status: normative specification for the 0.32 reference compiler.

ModelLang 0.32 consists of the complete [ModelLang 0.31 language](../0.31/LANGUAGE.md) plus [cursor pagination](./CURSOR_PAGINATION.md). A query may opt into deterministic keyset continuation by declaring `paginate cursor;` after its fixed authored limit. Queries without that clause retain their array result contract.

Version 0.32 advances canonical IR to IR21, operation manifest to v7, capability manifest to v6, UI manifest to v7, engineering semantic manifest/profile to v13, semantic diff to v14, and generator profile to `postgresql-http-ui-cursor-pagination/16`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, traversal, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.32 differs, this version takes precedence.
