# ModelLang 0.15 — Normative Language

Status: normative specification for the 0.15 reference compiler.

ModelLang 0.15 consists of the complete [ModelLang 0.14 language](../0.14/LANGUAGE.md) plus the [0.15 semantic closure, provenance, and change-analysis contracts](./SEMANTIC_CLOSURE.md).

Version 0.15 does not change `.model` source grammar, canonical IR9, operation manifest v2, UI manifest v2, HTTP routes or operation shapes, PostgreSQL enforcement, or guarded migration behavior. It adds independently versioned trusted-engineering and build-assurance artifacts derived from canonical IR and adds a non-mutating semantic-diff command.

Where 0.15 differs from an earlier version, the 0.15 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
