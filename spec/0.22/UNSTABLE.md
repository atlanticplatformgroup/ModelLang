# ModelLang 0.22 unstable boundaries

The following remain outside the stable contract: broker-specific polling and acknowledgement, retry schedules and backoff, dead-letter routing, retention and archival duration, replay administration, cross-context schema translation, consumer groups and partition assignment, global ordering, cross-model cycle detection, sagas and compensation, externally visible chain status, public inbox/outbox inspection, arbitrary event payload transforms, external side effects, and exactly-once network delivery.

Local consumer-event graphs are acyclic. This is a bounded safety rule, not a distributed process model. Correlation and causation provide trace linkage but grant no authority and do not coordinate compensation.

The stable guarantee is atomic one-step local effect plus ordered downstream outbox insertion, carried over at-least-once transport with duplicate-safe local consumption. It is not a global transaction or distributed exactly once.
