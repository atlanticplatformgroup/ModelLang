# ModelLang 0.5 stable-identity conformance

The 0.5 implementation is conformant when:

1. All 0.4 conformance tests continue to pass.
2. Explicit entity and field IDs are validated for kind, shape, and uniqueness.
3. IR version 5 separates stable identity from editable names.
4. Entity references and field-access expressions resolve through stable IDs.
5. `assign-ids` adds only missing IDs and is idempotent.
6. A current model compiled twice retains byte-identical IDs and IR.
7. Migration matching uses IDs only, never name similarity or source position.
8. Same-ID entity and field renames produce transactional `RENAME` DDL.
9. Applying a field rename preserves existing PostgreSQL data.
10. Added, removed, structurally changed, colliding, or name-derived declarations make migration planning fail.
11. Repeated migration planning is byte-identical.
