# ModelLang 0.23 durable consumer failure dispositions

Status: normative.

## Declarative policy

`retry maxAttempts N;` is a stable, consumer-local delivery policy. `N` is the maximum number of durably recorded failed handler deliveries before the generated delivery adapter returns terminal `deadLetter` disposition for that consumer and source event instance. The policy does not schedule retries, move a broker message, acknowledge delivery, or select a dead-letter destination.

A consumer without the clause has `unboundedRetry`. This preserves released IR13/IR14 behavior and never produces a policy-driven terminal disposition.

## Private failure state

Failure identity is stable consumer ID plus source event UUID. The private record retains failure count, greatest observed broker delivery attempt, last bounded stable error code, configured maximum when any, current disposition, and failure/resolution timestamps. It contains no exception message, stack, payload, principal, policy expression, or stored result.

After a handler transaction fails and rolls back, the generated adapter records the bounded failure in a separate database statement. The recorder atomically increments concurrent failures and derives `retry` or `deadLetter` from the canonical consumer policy; caller-supplied limits and dispositions are rejected. A committed inbox result dominates later conflicting or duplicate failure telemetry: the recorder ignores the failure without changing resolved state. An equivalent duplicate still replays as `consumed`; a changed-envelope conflict continues to fail without disclosing the committed result.

If failure recording itself is unavailable, the generated delivery adapter returns `retry` with `recorded: false`. It must never infer terminal state without a durable record. This is the only best-effort edge; a returned `deadLetter` disposition is always durable.

## Generated delivery adapter

For each consumer, TypeScript generates a broker-neutral `deliver...` function returning exactly one closed outcome:

- `consumed` with the typed stored or newly committed result;
- `retry` with a bounded error code, durable count when recorded, configured maximum, and `recorded` flag; or
- `deadLetter` with bounded error code, durable count, and configured maximum.

The existing `consume...` function remains the low-level compatibility boundary: it returns the typed result or rethrows the handler error after attempting private failure recording. Neither function acknowledges or mutates broker state.

A generated delivery call checks durable terminal state before invoking the handler. Once `deadLetter` is observed, later generated delivery calls return that disposition without authorization, mutable-state evaluation, effect, audit, inbox claim, or downstream emission. Already in-flight concurrent deliveries may complete; a committed success resolves prior failure state and remains authoritative.

## Success, replay, and atomicity

A newly committed handler success marks any existing private failure state `resolved` in the same transaction as effect, consumer audit, downstream events, inbox completion, and stored result. Committed duplicate replay returns before a new effect or downstream emission and preserves the resolved outcome.

Failure telemetry is outside the rolled-back handler transaction by necessity and grants no execution authority. It cannot make a failed effect durable. The inbox remains the sole committed-result identity; failure counts and dispositions are not receipts, capabilities, or evidence that an effect occurred.

## Privacy and operations

Failure state and delivery outcomes are server-only. They are absent from operation, capability, UI, HTTP, event, and agent-facing contracts. Application, gateway, dispatcher, and ordinary consumer code cannot inspect the table directly; the consumer role has execute-only access to generated state/record functions.

Retry timing, exponential backoff, jitter, broker acknowledgement, queue movement, dead-letter destinations, retention, alerting, manual reset/replay, and cross-model recovery remain deployment-owned.

## Evolution

IR15 retains the consumer failure policy. Adding, removing, or changing a bounded policy on an existing stable consumer changes operational behavior and requires reviewed acknowledgement. Adding a new consumer with a bounded policy remains additive.

Released IR9 through IR14 remain accepted evolution baselines when current source compiles to IR15. `013_upgrade_0_23.sql` is baseline checked and idempotently upgrades private failure state, installs policy-derived recorder/state functions and current adapters, and refreshes least-privilege grants. It does not fabricate historical failures, terminal dispositions, retries, dead letters, effects, or inbox completions.
