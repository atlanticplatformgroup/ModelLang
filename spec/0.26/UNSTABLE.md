# ModelLang 0.26 unstable boundaries

The following remain outside the stable contract: network publication, broker-specific polling and acknowledgement, retry scheduling, backoff and jitter, destinations or routing, broker message lookup/reconstruction/movement, operator approval workflow, multi-party approval, reason taxonomies beyond bounded stable codes, notification and alerting, retention and archival duration, public runtime delivery inspection, cross-model recovery, external side-effect deduplication, and exactly-once network delivery.

Manual publication recovery is one private PostgreSQL-local eligibility transition. It does not prove that a broker message exists, was moved, was redriven, or will be published. Recovery IDs, audit, static policy, and outcomes grant no model, dispatcher, consumer, application, or broker authority.

The stable guarantee is isolated audited reopening of an opted-in terminal outbox instance. It is not a scheduler, broker, queue administration system, redrive workflow, distributed transaction, or general operations console.
