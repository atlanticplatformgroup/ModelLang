# ModelLang 0.20 unstable boundaries

The following remain outside the stable language contract: broker-specific adapters, retry scheduling and dead-letter policy, retention and archival duration, partitioning and cross-model ordering, consumer registration, payload redaction/encryption policy, schema-registry publication, and exactly-once processing protocols.

The stable contract is limited to typed declaration, atomic private outbox creation, replay suppression, deterministic within-action ordinal, at-least-once lease delivery, static generated contracts, and guarded evolution.
