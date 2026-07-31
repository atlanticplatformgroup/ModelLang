# ModelLang 0.14 — Normative Language

Status: reference-compiler specification. Rules listed in `UNSTABLE.md` carry no compatibility guarantee.

ModelLang 0.14 consists of the complete [ModelLang 0.13 language](../0.13/LANGUAGE.md) plus the [0.14 workflow application-boundary semantics](./WORKFLOW_APPLICATIONS.md).

Version 0.14 does not change `.model` source grammar, canonical IR9, HTTP routes, PostgreSQL enforcement, or migration semantics. It advances the transport-neutral operation manifest to version 2 and the framework-neutral UI manifest to version 2 so existing workflow semantics can be consumed safely by applications.

Where 0.14 differs from an earlier version, the 0.14 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
