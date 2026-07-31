# ModelLang 0.17 — Normative Language

Status: normative specification for the 0.17 reference compiler.

ModelLang 0.17 consists of the complete [ModelLang 0.16 language](../0.16/LANGUAGE.md) plus the [0.17 authenticated applicability contract](./APPLICABILITY.md).

Version 0.17 does not change `.model` source grammar, canonical IR9, operation manifest v2, UI manifest v2, engineering semantic manifest v1, stored model shape, action/query meaning, or migration planning authority. It adds enforcement decision plan v1, filtered public capability manifest v1, authenticated action-applicability endpoints, explicit opaque revision comparison, and matching generated TypeScript helpers.

Discovery, applicability, and execution are distinct. Applicability never grants authority, and execution always re-evaluates the canonical decision plan inside its mutation transaction.

Where 0.17 differs from an earlier version, the 0.17 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
