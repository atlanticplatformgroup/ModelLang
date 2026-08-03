# ModelLang 0.35 — Normative Language

Status: normative specification for the 0.35 reference compiler.

ModelLang 0.35 consists of the complete [ModelLang 0.34 language](../0.34/LANGUAGE.md) plus [conditional field disclosure](./CONDITIONAL_FIELD_DISCLOSURE.md). Projection members may opt into a stable nullable disclosure contract with `redactable`, and each query may independently disclose an opted-in output path under an authored Boolean condition. A failed, unknown, or absent rule emits JSON `null` under the declared key; it never omits the key or adds row authority.

Version 0.35 advances canonical IR to IR24, operation manifest to v10, capability manifest to v9, UI manifest to v10, engineering semantic manifest/profile to v16, semantic diff to v17, and generator profile to `postgresql-http-ui-conditional-field-disclosure/19`. Decision plan v2, event manifest v5, event envelope v2, provenance format v1, stable HTTP routes, and private PostgreSQL runtime profile 29 remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, consumer, failure-operation, projection, traversal, filtering, sorting, pagination, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.35 differs, this version takes precedence.
