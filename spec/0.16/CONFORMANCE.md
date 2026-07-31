# ModelLang 0.16 reviewed-evolution conformance

The 0.16 implementation is conformant when:

1. All 0.15 language, enforcement, transport, UI, workflow, semantic-manifest, provenance, safe-migration, and golden-artifact tests continue to pass.
2. `.model` grammar, canonical IR9, operation manifest v2, UI manifest v2, engineering semantic manifest v1, public HTTP contracts, caller binding, and generated enforcement semantics remain unchanged.
3. `reviewed-migration-plan.schema.json` rejects unknown fields and provides no arbitrary SQL or imperative extension point.
4. Plan parsing validates exact released/current model references and all stable IDs before SQL generation.
5. Every non-additive semantic-diff v2 change is acknowledged exactly once, and persistent removals use a data-loss or transformation disposition.
6. Canonical plan hashing is deterministic and independent of JSON object-key order and semantically unordered plan-entry order.
7. Required fields on retained entities require a typed value source unless a ModelLang default, optionality, or database generation supplies the value.
8. Scalar enum member replacement uses explicit stable-ID mappings; missing mappings fail closed.
9. Field-type and enum-set transformations, principal replacement, schema replacement, name-derived durable declarations, and inferred rollback fail closed.
10. PostgreSQL creates and validates retained rows in a constrained staging schema before dropping the old model schema.
11. Retained row counts are equal before replacement, foreign keys are validated, and all current invariants and constraints apply to copied data.
12. The complete current workflows, authenticated action/query boundary, gateway identity boundary, and least-privilege grants are restored in the same transaction.
13. Replacement uses no cascading drop; undeclared model-schema objects or external dependents block migration rather than being silently deleted.
14. Invalid backfill data rolls back without changing old rows, old schema shape, or migration history.
15. Reviewed history records model ID, version, source hash, migration kind, and the exact canonical plan hash; stale or repeated application fails with `ML_MIGRATION_BASELINE`.
16. A live Procurement fixture proves invalid-plan rollback, accepted field removal, required-field backfill, scalar enum mapping, callable redeployment, history provenance, and repeated-application rejection.
