# ModelLang 0.4 enum-set conformance

The 0.4 implementation is conformant when:

1. All 0.3 conformance tests continue to pass.
2. `Set<T>` accepts declared enum element types and rejects scalar or entity element types.
3. Enum sets are accepted only on stored entity fields.
4. Set fields reject unsupported annotations, defaults, and non-direct assignments.
5. `member in set` requires matching enum and enum-set types.
6. Set equality, ordering, and all unlisted set operations fail compilation.
7. Optional-set membership preserves nullability and every Boolean enforcement boundary fails closed.
8. PostgreSQL stores sets as arrays and rejects undeclared, null, or duplicate elements.
9. Generated TypeScript entity fields expose arrays of the corresponding enum union.
10. A caller may hold more than one role and satisfy authorization through any contained role.
11. A snapshotted enum set remains unchanged after the source set changes.
12. Enum-set storage and membership rules appear in the enforcement map.
13. Repeated compilation and generation are byte-identical.
