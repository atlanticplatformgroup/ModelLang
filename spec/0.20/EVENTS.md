# ModelLang 0.20 transactional domain events

Status: normative.

## Declaration and payload

Event identity is stable and uses the `evt_[0-9a-f]{32}` namespace. Editable names are presentation metadata. A declared payload is exactly one entity type. `emit EventName;` is valid only after an action effect and only when the event payload entity equals the action's post-effect result entity. Source order defines event ordinal within one action.

The payload is the complete typed post-effect entity JSON already returned by the action. Model/source identity, stable event and action identities, target and principal identity, correlation and causation, action-audit and optional command-receipt linkage, event ordinal, and occurrence time are recorded beside it.

## Atomicity, replay, and failure

State mutation, invariants, workflow checks, audit, decision evidence, receipt completion, and all declared event rows commit in one PostgreSQL transaction. Any failure rolls them all back. Reliable-command replay returns its stored response before guards, mutation, audit, or event insertion, so it never creates duplicate event rows.

Event storage is private. Application and gateway roles cannot read or mutate it. An owner-controlled `modellang_dispatcher` role has execute-only access to lease, acknowledge, and release functions and is not a member of the owner, application, or gateway roles.

## Delivery

Delivery is at least once. A claim leases unpublished rows using `FOR UPDATE SKIP LOCKED`, bounded batch size, bounded lease duration, and deterministic occurrence-time/action-audit/ordinal/event-ID order. A successful publisher acknowledges with the event ID and unexpired lease token. A failed publisher may release its lease. A crash after external publication but before acknowledgement permits redelivery after lease expiry; consumers must therefore deduplicate by event ID.

The reference implementation does not claim exactly-once external delivery or a total order across concurrently committing transactions. Event IDs are stable delivery identities; action ordinal preserves declaration order within one action.

## Evolution

IR12 retains event declarations and ordered action emission IDs. Event renames preserve stable identity. Payload entity changes, removals, and changes to an existing action's emitted set require reviewed migration acknowledgement. Adding an unused event declaration is additive. `010_upgrade_0_20.sql` baseline-checks the installation, adds no synthetic historical events, installs the outbox and dispatcher functions idempotently, then redeploys actions and grants.
