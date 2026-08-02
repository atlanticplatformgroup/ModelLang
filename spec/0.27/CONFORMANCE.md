# ModelLang 0.27 conformance

An implementation conforms when it satisfies 0.26 conformance and:

1. confines terminal-failure inspection to a separate non-login observer role with execute-only function access and no recovery, dispatcher, consumer, model-operation, or table authority;
2. exposes only the normative minimal private publication and consumer projections through server-only typed adapters;
3. rejects incomplete cursors, future cutoffs, cursor positions after the cutoff, and page limits outside 1 through 100;
4. uses deterministic keyset order, excludes rows becoming terminal after the first-page cutoff, and never treats a cursor as authority;
5. derives current terminal state and recovery eligibility from trusted database and generated-contract state rather than caller claims;
6. appends exact immutable private observation audit for every successful page and rolls audit back with the request transaction;
7. keeps observation functions, cursors, items, operators, and audit absent from public and agent-facing contracts;
8. leaves IR18 and all public manifest and transport versions unchanged; and
9. provides baseline-checked idempotent `017_upgrade_0_27.sql` without mutating existing state or fabricating observations.
