# ModelLang 0.24 private consumer recovery

Status: normative.

## Declaration and authority

`recovery manual;` opts one bounded consumer into the generated manual recovery boundary. The declaration is static operational policy, not a public capability. It is invalid without a bounded `retry maxAttempts N;` policy because unbounded consumers have no policy-derived terminal state to reopen.

Recovery authority comes only from membership in the isolated `modellang_recovery` database role. Application, gateway, dispatcher, consumer, and caller identities are not recovery authority. The recovery function accepts stable consumer identity, source event UUID, and a bounded reason code; it never accepts a disposition, failure count, retry limit, principal identity, payload, result, or broker instruction.

## Atomic recovery

Recovery is valid only for an existing `deadLetter` record belonging to a consumer whose current canonical policy permits manual recovery. The function acquires the same private consumer/event transaction lock used by handler execution and failure recording, then checks committed inbox state and locks the failure row.

If the inbox already contains committed success, recovery returns `alreadyConsumed` and changes nothing. Missing, non-terminal, resolved, non-recoverable, or malformed targets fail closed without an audit row.

A successful recovery atomically:

- changes the failure disposition from `deadLetter` to `ready`;
- resets the current recovery-cycle failure count to zero while preserving a monotonic total failure count;
- increments a monotonic recovery generation;
- clears terminal time and records recovery time; and
- appends a private immutable audit snapshot with stable consumer/event identity, prior cycle and total counts, prior bounded error code, recovery generation, bounded reason code, and authenticated database principal.

Rollback preserves terminal state and creates no recovery audit.

## Delivery after recovery

`ready` allows a later generated delivery to invoke the normal handler. Recovery itself never invokes the handler. The host must separately arrange broker redelivery. A later handler failure begins a new cycle at count one and can reach the declared maximum again; the total count never decreases. A later success resolves the failure state atomically with the existing effect, evidence, downstream events, inbox completion, and stored result.

Recovery does not bypass envelope validation, source-contract validation, authorization, requirements, row locks, invariants, workflow checks, inbox identity, or conflict detection. A recovery record, generation, reason, role, or return value grants no execution authority.

## Generated adapter and privacy

For each opted-in consumer, the server-only generated TypeScript boundary exports a typed `recover...` function. It accepts an event UUID and reason code through a client bound to `modellang_recovery` and returns `recovered` with generation/count metadata or `alreadyConsumed`. Database errors remain fail closed.

Failure rows, recovery rows, reason codes, operator identities, counts, generations, and recovery outcomes remain absent from operation, capability, UI, HTTP, event, and agent-facing contracts. Runtime roles have no table access; the recovery role has execute-only access to the recovery function.

## Broker and operational boundary

Manual recovery does not select a queue, publish, requeue, acknowledge, reject, move, or delete a message. Broker credentials, message retention, dead-letter destinations, replay source, approval workflow, separation-of-duty policy, alerting, reason-code vocabulary, and operator authentication remain deployment-owned.

## Evolution and upgrade

IR16 retains manual-recovery policy inside the consumer failure policy. Adding, removing, or changing recovery policy on an existing stable consumer requires reviewed acknowledgement; an opted-in newly added consumer remains additive.

Released IR9 through IR15 remain accepted evolution baselines when current source compiles to IR16. `014_upgrade_0_24.sql` is baseline checked and idempotently installs the isolated role, recovery state columns, private audit, function, current handlers, and least-privilege grants. It does not reopen a failure, fabricate an audit, invoke a handler, create an inbox completion, or move a broker message.
