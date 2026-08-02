# ModelLang 0.30 — Normative Language

Status: normative specification for the 0.30 reference compiler.

ModelLang 0.30 consists of the complete [ModelLang 0.29 language](../0.29/LANGUAGE.md) plus [named read projections](./READ_PROJECTIONS.md). Every query declares one projection result and one entity row source. A projection is a closed, reusable output shape; it grants no authority and owns no row-selection policy.

Version 0.30 advances canonical IR to IR19, operation manifest to v5, capability manifest to v4, UI manifest to v5, engineering semantic manifest/profile to v11, semantic diff to v12, and generator profile to `postgresql-http-ui-read-projections/14`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, event-chain, failure, recovery, observation, acknowledgement, claim, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.30 differs, this version takes precedence.
