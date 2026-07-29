# ModelLang 0.3 — Normative Language

Status: reference-compiler specification. Rules listed in `UNSTABLE.md` carry no compatibility guarantee.

ModelLang 0.3 consists of:

1. the complete [ModelLang 0.2 normative core](../0.2/LANGUAGE.md); and
2. the [0.3 authenticated query semantics](./QUERIES.md).

Where the 0.3 documents differ from 0.2, the 0.3 rule takes precedence. In particular, application principals no longer receive direct table `SELECT`; declared queries are the only application read boundary.

The [grammar](./GRAMMAR.ebnf) extends the 0.2 grammar, and the [conformance requirements](./CONFORMANCE.md) are cumulative with 0.2.
