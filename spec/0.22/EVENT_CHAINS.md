# ModelLang 0.22 transactional consumer event chains

Status: normative.

## Declared emission

A consumer may list zero or more distinct `emit EventName;` clauses immediately after its create or update effect. Each event must be a local declaration whose complete payload entity equals the consumer return/effect entity. Source order defines a zero-based ordinal that is durable within that consumer execution. A consumer cannot emit an imported event contract.

Consumer-event dependencies must form a directed acyclic graph within one model. The compiler rejects direct and transitive cycles before IR generation. This prevents an entirely local declared event chain from becoming an unbounded feedback loop; cross-model orchestration, sagas, compensation, and broker routing remain outside the stable contract.

## Envelope v2 and producer identity

Envelope v2 retains the stable event instance ID, event contract, source model/version/hash, target, complete payload, correlation, causation, occurrence time, ordinal, and delivery attempt. It represents producer identity with nullable `actionId` and `consumerId`; exactly one is a well-formed stable semantic ID and the other is null.

An action-origin event carries its stable action ID. A consumer-origin event carries its stable consumer ID. Producer identity is generated from canonical IR and is never caller or broker input. The PostgreSQL dispatcher always returns envelope v2. Consumer handlers also accept the released v1 action envelope, normalize its absent `consumerId` to null, and fingerprint the normalized v2 content so semantically equivalent v1/v2 action deliveries share one inbox identity.

## Atomic downstream emission

For a new delivery, envelope and payload validation, inbox claim, authorization, named requirements, target locking, the local effect, constraints and workflows, consumer audit/evidence, downstream outbox insertion, inbox completion, and stored result occur in one transaction.

Each emitted event receives a database-owned UUID and the consumer's complete post-effect JSON result. Its correlation ID is inherited unchanged from the consumed event. Its causation ID is the consumed source event instance UUID rendered as text, irrespective of the source event's own causation. Its producer is the stable consumer ID and its producer audit link is the consumer-audit row committed in the same transaction.

An equivalent committed duplicate returns the stored result before authorization, mutable-state evaluation, the local effect, consumer audit, or downstream emission. Concurrent equivalent deliveries therefore commit exactly one local effect and one ordered set of downstream events. A conflicting envelope fails with `ML_EVENT_CONFLICT` and discloses no stored result.

Any handler, rule, constraint, workflow, audit, outbox, inbox, or outer transaction failure rolls back the complete chain step. No inbox completion or downstream event survives independently of its local effect.

## Storage, delivery, and privacy

The private outbox records exactly one producer kind, producer stable ID, and matching action- or consumer-audit reference. Existing action-origin rows are preserved and normalized by the upgrade. Dispatcher ordering remains deterministic by occurrence time, producer kind/audit identity, producer-local ordinal, and event UUID; no total order across concurrent producers is promised.

Downstream events still use at-least-once transport. Consumer-local committed handling remains duplicate safe, but ModelLang does not claim exactly-once network delivery or distributed exactly-once chains.

Consumer declarations and static event effects appear only in trusted engineering and event-contract artifacts. Event instances, inboxes, outboxes, payloads, fingerprints, stored responses, lease state, consumer evidence, and failure metadata remain private and are never projected into operation, capability, UI, HTTP, or agent-facing contracts.

## Evolution

IR14 retains each consumer's ordered emitted event IDs. Adding, removing, or reordering an existing consumer's emissions changes its durable effect and requires reviewed acknowledgement. Adding a new consumer remains additive subject to acyclic event dependencies.

Released IR9 through IR13 remain accepted evolution baselines when current source compiles to IR14. `012_upgrade_0_22.sql` is baseline checked and idempotently generalizes outbox producer provenance, installs envelope-v2 dispatch and current handlers, and refreshes least-privilege grants. It emits no historical event, executes no handler, changes no inbox completion, and fabricates no producer evidence.
