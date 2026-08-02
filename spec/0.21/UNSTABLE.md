# ModelLang 0.21 unstable boundaries

The following remain outside the stable contract: broker-specific polling and acknowledgement, retry schedules and backoff, dead-letter routing, retention and archival duration, replay administration, cross-context schema translation, consumer groups and partition assignment, global ordering, sagas and compensation, externally visible consumer status, public inbox inspection, arbitrary event payload transforms, handler-emitted events, and exactly-once network delivery.

Failure telemetry is private, bounded to stable error codes and delivery attempts, and best effort after a rolled-back handler. It is not a public diagnostic or authorization trace.

The stable guarantee is at-least-once transport plus duplicate-safe exactly-once local committed handling for one stable consumer identity. It is not distributed exactly once.
