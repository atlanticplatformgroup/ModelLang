# ModelLang 0.28 conformance

An implementation conforms when it satisfies 0.27 conformance and:

1. confines acknowledgement to a separate non-login role with execute-only acknowledgement access and no observation, recovery, dispatch, consumer, application, model-operation, or table authority;
2. accepts only private event identity and a bounded stable reason while deriving generation, disposition, stable contract identity, and database operator from trusted state;
3. acknowledges publication and consumer failures only while their selected recovery generation is currently terminal;
4. appends one immutable private acknowledgement per terminal generation without changing failure, recovery, claim, lease, inbox, outbox, domain, decision, receipt, or broker state;
5. serializes concurrent acknowledgement attempts to one committed row and returns closed `alreadyAcknowledged` thereafter without reason or operator disclosure;
6. serializes acknowledgement and recovery through the same failure-state locks with acknowledgement-first history preservation and recovery-first failure;
7. makes a later terminal generation begin unacknowledged;
8. adds only current-generation `acknowledged` Boolean to the private observer projection and exposes no acknowledgement audit detail;
9. generates a typed server-only acknowledgement adapter while keeping all public and agent-facing contracts and IR/public manifest versions unchanged; and
10. provides baseline-checked idempotent `018_upgrade_0_28.sql` that preserves existing state and fabricates no acknowledgement history.
