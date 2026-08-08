# ModelLang 0.50 conformance

A conforming implementation:

1. implements the complete ModelLang 0.49 language and conformance requirements;
2. accepts one or more ordered action effects while preserving existing single-effect source compatibility;
3. emits canonical IR2 with deterministic effect IDs and zero-based order;
4. requires the final effect to produce the action return entity and rejects repeated updates to the same target;
5. locks every update target before evaluating authorization or requirements and executes all effects in source order in one database transaction;
6. rolls back every effect, evidence write, receipt update, and event write if any effect fails;
7. treats required idempotency as covering the complete effect list and replays only the stored final result;
8. preserves workflow enforcement when the transition update is one effect among several;
9. records private action-level evidence plus one private affected-record evidence row per committed effect; and
10. emits compiler/package 0.50.0, semantic manifest v19, semantic diff v20, generator profile `/33`, and otherwise retains the public contract axes named in the 0.50 language specification.
