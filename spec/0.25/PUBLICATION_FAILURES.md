# ModelLang 0.25 private event-publication failures

Status: normative.

## Declaration and policy

`retry maxAttempts N` on a local event opts each produced outbox instance into bounded recorded publication failure. Omission means unbounded retry. Imported events cannot declare publication policy because this model never produces their outbox instances.

The policy is copied into each outbox row when the producing action or consumer commits. Changing current source does not retroactively reinterpret an already committed instance. The stable event ID, not its editable name, selects the declared policy.

## Lease-bound outcomes

Only the isolated `modellang_dispatcher` role can claim, acknowledge, release, or record publication failure. Recording accepts only the outbox event UUID, current lease token, and a bounded stable error code. It never accepts failure count, maximum attempts, disposition, payload, principal, correlation, destination, or broker instruction.

Failure recording succeeds only for an unpublished pending row under a live matching lease. It atomically increments the recorded failure count, clears the lease, stores the bounded error, and returns:

- `retry` while the copied policy remains unbounded or the count is below its maximum; or
- `deadLetter` when the bounded maximum is reached.

A terminal row is excluded from later claims. Acknowledgement marks only a live matching lease as published. Release clears only a matching lease and does not count as a failure. Lease expiry permits later claim and increments delivery attempt telemetry, but neither expiry nor a dispatcher crash fabricates a recorded failure.

Concurrent acknowledgement, release, failure recording, and lease expiry are serialized by the outbox row and lease token. Exactly one live lease transition can commit.

## Generated adapter and privacy

The generated server-only dispatcher adapter exposes typed claim, acknowledge, release, and failure-recording functions over the execute-only database boundary. Claimed envelopes carry the existing private lease token and delivery-attempt telemetry. Failure outcomes are closed `retry` or `deadLetter` values.

Outbox rows, payload instances, lease tokens, attempts, recorded counts, error codes, terminal times, and outcomes remain absent from operation, capability, UI, HTTP, and agent-facing contracts. Event manifest v4 exposes only the static declared failure policy.

## Broker boundary

ModelLang does not perform network publication or broker acknowledgement. The host publishes a claimed typed envelope, acknowledges the outbox row after broker acceptance, records a bounded error after a known publication failure, or releases an unused lease. Retry timing, backoff, jitter, destinations, broker dead-letter movement, alerts, retention, and operator recovery remain deployment-owned.

`deadLetter` is a private outbox disposition, not proof that any broker message exists or moved. It grants no execution, recovery, or administrative authority.

## Evolution and upgrade

IR17 preserves each event publication failure policy. Adding, removing, or changing that policy on an existing stable event requires reviewed acknowledgement; a newly added event remains additive.

Released IR9 through IR16 remain accepted evolution baselines when current source compiles to IR17. `015_upgrade_0_25.sql` is baseline checked and idempotently installs private publication state, lease-bound failure recording, current outbox functions, and least-privilege grants. Existing unpublished outbox rows receive the previous unbounded policy; no failure, terminal disposition, publication, lease, or broker history is fabricated.
