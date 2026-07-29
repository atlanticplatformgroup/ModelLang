# ModelLang 0.3 query conformance

The 0.3 implementation is conformant when:

1. All 0.2 conformance tests continue to pass.
2. A query has exactly one authenticated caller using the model principal type.
3. The caller is absent from SQL and TypeScript callable parameters.
4. Query authorization cannot reference the row alias.
5. Row filters are typed Boolean expressions and fail closed.
6. Entity equality in filters compares primary-key identity.
7. Entity query parameters are existence-checked.
8. Ordering is a required direct non-optional row field with an automatic ID tie-breaker.
9. Limits outside 1 through 1000 fail compilation.
10. Generated query functions return deterministic bounded JSON arrays.
11. Application logins cannot directly `SELECT` entity tables.
12. A Procurement caller cannot obtain another employee’s requests.
13. A Reservations caller can query one resource without obtaining rows for another resource.
14. Every query authorization, row policy, order, limit, caller binding, and read privilege appears in the enforcement map.
15. Repeated compilation is byte-identical.
