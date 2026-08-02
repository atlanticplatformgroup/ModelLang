# ModelLang 0.23 conformance

An implementation conforms when it satisfies 0.22 conformance and:

1. parses at most one consumer `retry maxAttempts N;` clause in the required position;
2. rejects non-integer limits and values outside 1–1000;
3. preserves bounded or unbounded consumer failure policy in IR15 and the trusted semantic manifest;
4. records failure count and policy-derived disposition privately by stable consumer plus source event identity;
5. derives limits from canonical IR rather than caller or broker input and atomically serializes concurrent failure updates;
6. emits `deadLetter` only from durable terminal state and falls back to unrecorded `retry` when recording fails;
7. generates closed typed `consumed`, `retry`, and `deadLetter` broker-neutral delivery outcomes without acknowledging broker state;
8. resolves prior failure state atomically with a successful effect, audit, downstream emission, inbox completion, and result;
9. lets committed inbox success dominate later duplicate or conflicting failure telemetry;
10. keeps private failures and dispositions out of public operation, capability, UI, HTTP, event, and agent-facing contracts;
11. classifies existing-consumer failure-policy changes for reviewed acknowledgement and accepts IR9–IR14 baselines for IR15 current input; and
12. provides a baseline-checked idempotent `013_upgrade_0_23.sql` without fabricated historical failure state.
