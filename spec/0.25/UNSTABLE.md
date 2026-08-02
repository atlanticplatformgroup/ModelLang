# ModelLang 0.25 unstable boundaries

The following remain outside the stable contract: network publication, broker-specific polling and acknowledgement, retry timing, backoff and jitter, destinations or routing, broker message movement, publication recovery/redrive, operator approval workflows, separation of duties beyond the dispatcher role, error taxonomies beyond bounded stable codes, retention and archival duration, alerting, batching guarantees across claims, partition assignment, global ordering, sagas and compensation, public runtime delivery inspection, external side-effect deduplication, and exactly-once network delivery.

A private `deadLetter` disposition proves only that the declared number of lease-bound publication failures was durably recorded. It does not prove that a broker received, rejected, retained, or moved a message. Dispatcher outcomes and static event policy grant no model authority.

The stable guarantee is bounded broker-neutral disposition around the private transactional outbox. It is not a scheduler, broker, queue administration system, distributed transaction, or publication recovery workflow.
