# ModelLang 0.19 — Normative Language

Status: normative specification for the 0.19 reference compiler.

ModelLang 0.19 consists of the complete [ModelLang 0.18 language](../0.18/LANGUAGE.md) plus required action idempotency and the [reliable command contract](./RELIABLE_COMMANDS.md).

Version 0.19 adds the `idempotency required;` action-body declaration. It advances the canonical backend boundary to IR11, operation manifest to v3, capability manifest to v2, UI manifest to v3, engineering semantic manifest to v3, and semantic diff to v4. Decision plan v2 and the existing HTTP operation routes remain unchanged.

All locked identity, value, authorization, applicability, policy, evidence, workflow, migration, PostgreSQL privilege, and fail-closed semantics from earlier versions remain normative.

Where 0.19 differs from an earlier version, the 0.19 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
