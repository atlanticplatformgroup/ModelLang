# ModelLang 0.12 — Normative Language

Status: reference-compiler specification. Rules listed in `UNSTABLE.md` carry no compatibility guarantee.

ModelLang 0.12 consists of the complete [ModelLang 0.11 language](../0.11/LANGUAGE.md) plus the [0.12 PostgreSQL gateway identity semantics](./GATEWAY_IDENTITY.md).

Version 0.12 does not change `.model` source grammar, canonical IR9, operation manifest v1, or the public HTTP contract. It adds a server-side identity adapter and PostgreSQL enforcement profile for safely sharing a connection pool across authenticated principals.

Where 0.12 differs from an earlier version, the 0.12 rule takes precedence. [Conformance](./CONFORMANCE.md) is cumulative.
