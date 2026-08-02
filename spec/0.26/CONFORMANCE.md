# ModelLang 0.26 conformance

An implementation conforms when it satisfies 0.25 conformance and:

1. parses at most one `recovery manual` clause after a local event's bounded publication retry policy;
2. rejects publication recovery on imported or unbounded events;
3. preserves `none` or `manual` recovery in IR18, event manifest v5, and trusted semantic manifest v10;
4. copies recovery eligibility into each newly committed outbox instance and never retroactively enables upgraded rows;
5. confines recovery to an isolated execute-only publication-recovery role with no dispatcher or table authority;
6. accepts only outbox identity and a bounded reason while deriving eligibility, counts, prior error, generation, and operator from private state;
7. atomically locks and changes only eligible `deadLetter` state to `pending`, resets the current cycle, preserves monotonic total failures, and increments generation;
8. appends exact immutable private audit in the same transaction and rolls both state and audit back together;
9. allows only the ordinary dispatcher path to claim and publish after recovery and performs no broker operation itself;
10. generates a typed server-only recovery adapter without widening public or agent-facing contracts;
11. classifies existing-event recovery-policy changes for reviewed acknowledgement and accepts IR9–IR17 baselines for IR18 current input; and
12. provides baseline-checked idempotent `016_upgrade_0_26.sql` that keeps existing rows ineligible and fabricates no recovery or broker history.
