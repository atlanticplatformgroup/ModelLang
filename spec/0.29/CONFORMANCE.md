# ModelLang 0.29 conformance

An implementation conforms when it satisfies 0.28 conformance and:

1. confines terminal-failure claiming to a separate non-login role with execute-only claim access and no observation, acknowledgement, recovery, dispatch, consumer, application, model-operation, or table authority;
2. accepts only private event identity while deriving generation, disposition, stable contract identity, and claimant database principal from trusted state;
3. claims publication and consumer failures only while their selected recovery generation is currently terminal;
4. appends one immutable private first-writer claim per terminal generation without changing failure, recovery, acknowledgement, dispatcher claim, lease, inbox, outbox, domain, decision, receipt, or broker state;
5. serializes concurrent attempts to one committed row and returns closed `alreadyClaimed` thereafter without claimant disclosure;
6. serializes claiming and recovery through the same failure-state locks with claim-first history preservation and recovery-first failure;
7. makes a later terminal generation begin unclaimed;
8. adds only current-generation `claimed` Boolean to the private observer projection and exposes no claim record detail;
9. generates a typed server-only claim adapter while keeping all public and agent-facing contracts and IR/public manifest versions unchanged; and
10. provides baseline-checked idempotent `019_upgrade_0_29.sql` that preserves existing state and fabricates no claim history.
