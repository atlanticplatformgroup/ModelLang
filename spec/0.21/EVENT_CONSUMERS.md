# ModelLang 0.21 reliable typed event consumption

Status: normative.

## Declaration and source contracts

A consumer has stable `con_[0-9a-f]{32}` identity, binds exactly one declared event, accepts exactly that event's complete payload entity, declares Boolean authorization and ordered named requirements, and performs one local create or update effect. An update targets the payload entity identity. A create may project payload fields into another local entity. Consumer effects cannot assign generated or immutable fields or bypass a declared workflow field.

A local event contract expects the current model ID, model version, and exact source hash. An imported event declaration fixes the producer model ID, model version, and source hash explicitly. Imported events cannot be emitted locally. Changing a source contract, accepted payload, handler authorization, requirements, or effect is guarded semantic evolution.

The consumer payload parameter denotes the immutable source-event payload snapshot. It is never authenticated caller identity and does not grant authority. Consumer authorization is an event-acceptance rule evaluated over the typed payload; it may call the same closed pure policies as actions. Runtime invocation is restricted to the isolated `modellang_consumer` role.

## Envelope validation

The broker-neutral envelope is closed and contains event instance ID, stable event ID and name, producer model/version/source hash, stable action ID, target ID, complete payload, correlation and optional causation IDs, occurrence time, ordinal, and positive delivery attempt. Unknown properties, missing properties, malformed values, unknown or mismatched event identity, source mismatch, payload shape/type mismatch, and target/payload identity mismatch fail closed before a local effect.

Payload validation includes exact fields, nullability, UUID/date/time/numeric decoding, enum membership, duplicate-free enum sets, and exact Money currency/shape. Consumer invocation does not expose or accept outbox lease tokens, authenticated principals, action receipts, or decision evidence.

## Transactional inbox and concurrency

The private inbox identity is stable consumer ID plus source event instance ID. The first delivery claims that identity in the same transaction that validates the envelope and payload, evaluates authorization and requirements, locks any update target, performs the effect, enforces database constraints and workflows, writes private consumer audit/evidence, completes the inbox row, and stores the exact JSON result.

The canonical SHA-256 envelope fingerprint covers every closed envelope field except the mutable transport delivery-attempt counter. Reuse of an inbox identity with a different fingerprint fails with `ML_EVENT_CONFLICT` and discloses no stored result.

Concurrent equivalent deliveries serialize on the inbox uniqueness boundary. Exactly one handler effect and consumer-audit row commit. A later equivalent duplicate returns the stored result without re-evaluating authorization, requirements, mutable state, or the handler because replay is not a new local effect. It may advance private last-delivery-attempt telemetry.

Any handler, authorization, requirement, constraint, invariant, workflow, exclusion, or outer transaction failure rolls back the inbox claim, local effect, audit/evidence, and stored result together. The event may then be retried. Exactly-once local committed handling is scoped to one stable consumer identity; network delivery remains at least once.

## Privacy and failures

Inbox rows, payloads, fingerprints, stored results, source metadata, consumer evidence, and failure telemetry live in the owner-controlled internal schema. Application, gateway, and dispatcher roles cannot access them. The consumer role receives execute-only access to declared consumer functions and a bounded private failure-metadata function.

Generated TypeScript consumer adapters are server-only and broker-neutral. They accept the typed v1 event envelope, invoke one generated database consumer, return the stored or newly committed result, and may record only a stable private error code plus delivery-attempt metadata after failure. They do not prescribe Kafka, SQS, HTTP, or another transport.

## Evolution

IR13 retains consumer identity, source event identity, accepted payload entity, rules, lock/effect plan, and duplicate-handling contract. Adding a consumer is safe and additive. Removal or a source-contract, payload, result, authorization, requirement, delivery, or effect change requires reviewed acknowledgement. Consumer names may change without changing inbox identity, but physical handler replacement remains generated and reviewed when semantics differ.

Released IR9 through IR12 remain accepted evolution baselines when current source compiles to IR13. `011_upgrade_0_21.sql` is baseline checked and idempotently installs the consumer role, private inbox/audit/failure boundary, generated handlers, and least-privilege grants. It consumes no historical event and fabricates no completion record.
