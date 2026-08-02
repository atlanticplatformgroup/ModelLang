# ModelLang 0.33 conformance

An implementation conforms when it satisfies 0.32 conformance and:

1. parses `?` only after a non-caller query parameter type;
2. rejects optional caller parameters and leaves action, policy, and consumer parameter syntax required;
3. represents an optional query parameter as nullable in IR expressions while preserving its non-null base type;
4. treats transport omission and explicit JSON null as the same nullable input state;
5. validates every present non-null value against the existing scalar, enum, exact-money, or entity-reference contract;
6. performs no implicit filter rewrite, default, truthiness conversion, or predicate inference;
7. evaluates the authored authorization and row policy with fail-closed `IS TRUE` semantics;
8. skips entity loading and exact-money validation only for null optional values, while failing closed for invalid present values;
9. emits consistent optionality through PostgreSQL, TypeScript, operation manifest, OpenAPI, HTTP validation, UI descriptors, and engineering semantics;
10. includes null or concrete optional filter values in cursor input binding and rejects cross-filter cursor reuse as stale;
11. classifies optionality changes as breaking callable-contract changes and does not infer safe query evolution;
12. accepts IR9 through IR21 as required-input evolution baselines without fabricating optionality;
13. emits IR22, operation manifest v8, capability manifest v7, UI manifest v8, semantic manifest/profile v14, semantic diff v15, and generator profile `/17`; and
14. preserves all locked earlier safety, privacy, deterministic generation, pagination, evolution, and privilege semantics.
