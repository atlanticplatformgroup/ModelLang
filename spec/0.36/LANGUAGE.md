# ModelLang 0.36 — Normative Language

Status: normative specification for the 0.36 reference compiler.

ModelLang 0.36 consists of the complete [ModelLang 0.35 language](../0.35/LANGUAGE.md) plus [transactional read evidence](./TRANSACTIONAL_READ_EVIDENCE.md). A query may opt into `audit reads;`, causing each successful committed invocation to append private evidence that binds authenticated identity and a stable query revision to canonical request and exact response hashes. Query output shapes and callable inputs do not change.

Version 0.36 advances canonical IR to IR25, operation manifest to v11, capability manifest to v10, UI manifest to v11, engineering semantic manifest/profile to v17, semantic diff to v18, generator profile to `postgresql-http-ui-transactional-read-evidence/20`, and the private PostgreSQL runtime profile to 36. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, and stable HTTP routes remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, traversal, filtering, sorting, pagination, disclosure, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.36 differs, this version takes precedence.
