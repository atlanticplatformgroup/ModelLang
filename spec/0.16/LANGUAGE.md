# ModelLang 0.16 — Normative Language

Status: normative specification for the 0.16 reference compiler.

ModelLang 0.16 consists of the complete [ModelLang 0.15 language](../0.15/LANGUAGE.md) plus the [0.16 reviewed semantic-evolution contract](./REVIEWED_EVOLUTION.md).

Version 0.16 does not change `.model` source grammar, canonical IR9, operation manifest v2, UI manifest v2, engineering semantic manifest v1, HTTP routes, public operation shapes, authenticated caller semantics, or PostgreSQL action/query enforcement. It adds a second, explicitly reviewed migration path for changes that the 0.10 safe planner must continue to reject.

Semantic diff advances to version 2 only to name both separate guarded migration authorities. A semantic-diff report remains analysis rather than executable migration authority.

Where 0.16 differs from an earlier version, the 0.16 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
