# ModelLang 0.24 unstable boundaries

The following remain outside the stable contract: broker polling and acknowledgement, retry timing and backoff, jitter, dead-letter destinations or message movement, selection and retrieval of a replayable message, operator approval workflows, authored separation of duties, reason-code taxonomies, retention and archival duration, alerting, bulk recovery, automatic recovery, cross-context translation, consumer groups and partition assignment, global ordering, sagas and compensation, public failure/recovery inspection, arbitrary payload transforms, external side effects, and exactly-once network delivery.

The recovery role is a deployment-provisioned operational authority, not a model principal or agent capability. A recovery outcome proves only that private terminal state was reopened and audited. It does not prove that a broker message exists or was requeued, nor that a later handler will succeed.

The stable guarantee is an opt-in, single-event, private, audited transition from durable terminal failure to handler eligibility. It is not a queue administration system, scheduler, approval workflow, distributed transaction, or general recovery orchestrator.
