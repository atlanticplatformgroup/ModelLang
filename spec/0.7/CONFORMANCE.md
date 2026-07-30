# ModelLang 0.7 generated-value conformance

The 0.7 implementation is conformant when:

1. All 0.6 conformance tests continue to pass.
2. Only required `UUID @generated(uuid)` and required `DateTime @generated(now)` fields compile.
3. Generated fields reject source defaults, snapshots, unknown strategies, and all action assignments.
4. Immutable fields reject update assignments while permitting create assignments when they are not generated.
5. IR version 7 represents database generation and field mutability independently from ordinary source defaults.
6. PostgreSQL emits qualified database defaults, omits generated columns from inserts, and returns generated values from the same transaction.
7. Generated-only create effects use valid `DEFAULT VALUES` SQL.
8. TypeScript action inputs contain only declared non-caller parameters and entity results include generated fields.
9. Enforcement analysis requires a generated-value target and an immutable-action target for every applicable field.
10. The canonical Procurement and Reservations creation actions accept neither entity IDs nor creation timestamps.
11. Live PostgreSQL tests prove generated UUID shape, generated timestamps, caller-free identity authority, and successful audit attribution.
12. The migration planner treats generation and mutability changes as structural changes and fails closed.
