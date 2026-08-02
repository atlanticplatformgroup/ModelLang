# ModelLang 0.25 conformance

An implementation conforms when it satisfies 0.24 conformance and:

1. parses at most one `retry maxAttempts N` clause after an event payload/source contract and validates `N` from 1 through 1000;
2. rejects bounded publication policy on imported events;
3. preserves unbounded or bounded event publication failure policy in IR17, event manifest v4, and trusted semantic manifest v9;
4. copies the current stable-event policy into each locally committed outbox instance;
5. confines claim, acknowledgement, release, and failure recording to the isolated dispatcher role and live matching lease tokens;
6. atomically increments only explicitly recorded failures, clears the lease, and returns policy-derived `retry` or `deadLetter`;
7. excludes terminal rows from claims while keeping release and lease expiry non-counting;
8. serializes competing lease transitions so exactly one acknowledgement, release, or failure record can commit;
9. generates a typed server-only dispatcher adapter without widening public or agent-facing contracts;
10. keeps runtime outbox state, payloads, leases, counts, errors, and outcomes private while exposing only static policy in event manifest v4;
11. classifies existing-event publication-policy changes for reviewed acknowledgement and accepts IR9–IR16 baselines for IR17 current input; and
12. provides a baseline-checked idempotent `015_upgrade_0_25.sql` that preserves existing rows as unbounded and fabricates no failure, terminal, publication, lease, or broker history.
