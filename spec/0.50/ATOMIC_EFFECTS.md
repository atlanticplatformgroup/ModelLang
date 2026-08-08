# Atomic multi-entity action effects

ModelLang 0.50 lets an action declare one or more `create` or `update` effects. Effects appear after authorization, named requirements, and optional idempotency, and before emitted events.

```modellang
action approve(caller actor: User, reservation: Reservation) -> Loan {
  authorize Role.STAFF in actor.roles;
  require pending: reservation.state == ReservationState.PENDING;

  update reservation {
    state = ReservationState.APPROVED;
    decidedBy = actor;
  }
  create Loan {
    reservation = reservation;
    member = reservation.member;
    approvedBy = actor;
  }
}
```

## Semantics

- An action has a non-empty ordered effect list. Existing one-effect source remains valid.
- The final effect entity MUST match the action return entity. Its committed row is the action result and any emitted-event payload.
- An update target MUST be a non-caller entity parameter. The same parameter MUST NOT be updated more than once in one action.
- Effect expressions may reference action inputs and the authenticated caller. They observe the locked pre-effect snapshot; this release does not introduce names that expose rows created by earlier effects.
- Every update target is locked `FOR UPDATE` before authorization and requirements are evaluated. Other referenced entity inputs are locked `FOR SHARE`. The canonical lock plan orders locks by entity and source identity.
- All authorization, requirements, effects, per-effect evidence, action evidence, receipt completion, and event-outbox writes execute in one PostgreSQL transaction. Any failure rolls back all of them.
- A required idempotency key identifies the whole action. Replay returns the stored final result and does not repeat any effect.
- Workflow transitions may be implemented by any matching update in the ordered effect list. Database workflow triggers and entity constraints remain authoritative for every effect.

## Canonical representation and evidence

Canonical IR2 replaces `IRAction.effect` with non-empty `IRAction.effects`. Each effect has a deterministic action-local `id`, zero-based `order`, kind, target, entity ID, and typed assignments.

The private `action_audit` record continues to identify the action and final target for compatibility. The private `action_effect_audit` relation adds one row per committed effect with its effect ID, ordinal, kind, entity ID, and affected target ID. Public HTTP, TypeScript, MCP, operation-manifest, capability, and event payload shapes do not expose this engineering evidence.

## Deliberate boundaries

ModelLang 0.50 does not support updating the same target twice, binding a created row for use by a later effect, returning multiple rows, partial success, independent effect retries, or multi-database transactions.
