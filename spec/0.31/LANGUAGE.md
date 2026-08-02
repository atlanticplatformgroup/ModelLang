# ModelLang 0.31 — Normative Language

Status: normative specification for the 0.31 reference compiler.

ModelLang 0.31 consists of the complete [ModelLang 0.30 language](../0.30/LANGUAGE.md) plus [bounded to-one projection traversal](./TO_ONE_TRAVERSAL.md). A projection member may explicitly name another projection when its source field is a to-one entity reference. The authored acyclic dependency graph is the complete traversal bound.

Version 0.31 advances canonical IR to IR20, operation manifest to v6, capability manifest to v5, UI manifest to v6, engineering semantic manifest/profile to v12, semantic diff to v13, and generator profile to `postgresql-http-ui-to-one-traversal/15`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.31 differs, this version takes precedence.
