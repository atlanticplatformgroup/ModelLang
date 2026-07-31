# ModelLang 0.15 semantic-closure conformance

The 0.15 implementation is conformant when:

1. All 0.14 language, workflow, UI, transport, identity, enforcement, migration, and golden-artifact tests continue to pass.
2. Source grammar, canonical IR9, operation manifest v2, UI manifest v2, stable HTTP routes and operation shapes, PostgreSQL output, and migration behavior remain unchanged.
3. Every compilation deterministically emits `semantic.json` conforming to `schemas/semantic-manifest.schema.json` and declaring semantic manifest version 1 and profile `sml-transactional-core/1`.
4. The semantic manifest is marked engineering-only, unfiltered, static, and non-executable.
5. The semantic manifest records the compiler version, IR version, model identity, model version, source hash, and source file.
6. Authenticated caller identity is represented only as context and remains absent from callable input and current values.
7. Every action exposes normalized authorization and precondition expressions, stable dependencies, read sets, lock plans, explicit assignments, linked postconditions, workflow bindings, source spans, and failure classes.
8. Every query exposes separate authorization and row-policy semantics, dependencies, read sets, deterministic ordering, bounds, source spans, and failure classes.
9. `semantic.json` contains no SQL names, database credentials, HTTP paths, UI components, current entity state, bearer credentials, or caller identity values.
10. Every compilation deterministically emits `provenance.json` conforming to `schemas/artifact-provenance.schema.json`.
11. Provenance records compiler, generator, model, source, and IR identity plus a role and correct SHA-256 hash for every other generated artifact; it contains no nondeterministic timestamp and does not recursively hash itself.
12. `modelc semantic-diff` emits a schema-valid, deterministic, non-mutating report matched by semantic ID rather than current name.
13. Semantic diff reports multiple changes and classifies known identity, structure, validation, authorization, visibility, lifecycle, effect, and persistence impacts without claiming general predicate implication.
14. Ambiguous compatibility is `review`, and the report states that the separate safe migration planner remains migration authority.
15. Procurement and Reservations golden artifacts include the new trusted-engineering and provenance documents while all existing generated enforcement and application behavior remains unchanged.
