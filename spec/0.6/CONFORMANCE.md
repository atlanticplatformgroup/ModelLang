# ModelLang 0.6 declaration-identity conformance

The 0.6 implementation is conformant when:

1. All 0.5 conformance tests continue to pass.
2. Every supported declaration ID is validated for kind, shape, and uniqueness.
3. IR version 6 separates stable identity from editable names for every supported declaration.
4. Enum types and enum literals reference stable enum and member IDs.
5. Derived parameter, rule, lock, enforcement, and audit IDs remain stable when their owning declaration is renamed.
6. `assign-ids` covers every supported declaration, preserves existing IDs, and is idempotent.
7. Migration matching uses IDs only.
8. Same-ID entity, field, invariant, exclusion, action, and query renames produce deterministic transactional PostgreSQL DDL.
9. Same-ID enum declaration renames are recognized without rewriting stored member values.
10. Applying supported renames preserves stored rows, foreign keys, constraints, and callable functions.
11. Enum-member renames and semantic, additive, removed, colliding, or name-derived changes fail closed.
12. Generated SQL, TypeScript, Mermaid, and enforcement artifacts resolve semantic references through IDs.
