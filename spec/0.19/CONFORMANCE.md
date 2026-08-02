# ModelLang 0.19 reliable-command conformance

The 0.19 implementation is conformant when:

1. `idempotency required;` is accepted only in an action body, at most once, after rules and before the effect.
2. IR11 and trusted/public projections preserve the declaration without treating execution metadata as model input.
3. A marked action rejects missing or malformed keys; an unmarked action rejects supplied keys.
4. Receipt identity is scoped by authenticated principal, stable action ID, and key.
5. The canonical SHA-256 request fingerprint includes stable typed inputs, expected revision, correlation, and causation metadata.
6. Same-key input or source mismatch fails closed without disclosing the stored result.
7. Equivalent retry returns the stored committed result without another effect, audit row, or policy evaluation.
8. Concurrent equivalent requests produce exactly one effect, audit row, and receipt.
9. Rollback and every failed execution path leave no durable receipt.
10. Correlation and causation are recorded with action audit and decision evidence, and an idempotent audit links to its receipt.
11. Receipts and evidence remain private and grant no authority.
12. Applicability rejects command metadata, creates no receipt, and retains `authority: "none"`.
13. Operation manifest v3, capability manifest v2, UI manifest v3, semantic manifest v3, and OpenAPI expose only static reliability requirements.
14. Safe and reviewed evolution fail closed for unapproved idempotency changes and accept an IR10 baseline for an IR11 current model.
15. `009_upgrade_0_19.sql` is baseline checked, idempotent, and preserves domain and historical audit rows.
