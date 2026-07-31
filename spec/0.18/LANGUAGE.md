# ModelLang 0.18 — Normative Language

Status: normative specification for the 0.18 reference compiler.

ModelLang 0.18 consists of the complete [ModelLang 0.17 language](../0.17/LANGUAGE.md) plus first-class reusable policies and [durable decision evidence](./POLICY_DECISIONS.md).

Version 0.18 adds `policy` declarations, closed named `allow` branches, and typed policy calls in Boolean expressions. It advances the canonical backend boundary to IR10, enforcement decision plan to v2, engineering semantic manifest to v2, and semantic diff to v3. Operation manifest v2, UI manifest v2, capability manifest v1, HTTP routes, authenticated caller binding, applicability response shapes, and stored domain entity shapes remain unchanged.

The PostgreSQL profile remains the first enforcement backend. Discovery, applicability, and execution remain separate; public applicability remains filtered and non-authoritative, while successful execution records private evidence in the same transaction as the effect and action audit.

Where 0.18 differs from an earlier version, the 0.18 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
