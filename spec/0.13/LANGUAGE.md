# ModelLang 0.13 — Normative Language

Status: reference-compiler specification. Rules listed in `UNSTABLE.md` carry no compatibility guarantee.

ModelLang 0.13 consists of the complete [ModelLang 0.12 language](../0.12/LANGUAGE.md) plus the [0.13 framework-neutral UI manifest semantics](./UI_MANIFEST.md).

Version 0.13 does not change `.model` source grammar, canonical IR9, operation manifest v1, the public HTTP contract, or PostgreSQL enforcement. It adds a separately versioned presentation contract derived only from operation manifest v1 and a browser-safe stable-ID executor over the generated HTTP client.

Where 0.13 differs from an earlier version, the 0.13 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
