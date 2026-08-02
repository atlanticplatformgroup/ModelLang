# ModelLang 0.23 unstable boundaries

The following remain outside the stable contract: broker-specific polling and acknowledgement, retry timing and backoff, jitter, dead-letter destinations or message movement, retention and archival duration, alerting, manual reset/replay administration, cross-context schema translation, consumer groups and partition assignment, global ordering, cross-model cycle detection, sagas and compensation, externally visible chain status, public inbox/outbox/failure inspection, arbitrary payload transforms, external side effects, and exactly-once network delivery.

The durable disposition is a private host-consumable decision, not proof that a broker acknowledged, retried, or moved a message. A terminal disposition grants no authority and does not erase the source event. Already in-flight concurrent deliveries may finish; committed inbox success remains authoritative and resolves earlier failure state.

The stable guarantee is bounded private failure accounting and broker-neutral delivery disposition around the existing atomic local handler boundary. It is not a scheduler, queue, distributed transaction, or recovery workflow.
