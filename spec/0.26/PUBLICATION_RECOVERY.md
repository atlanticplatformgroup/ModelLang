# ModelLang 0.26 private event-publication recovery

Status: normative.

## Declaration and copied eligibility

`recovery manual` on a bounded local event opts each newly produced outbox instance into manual terminal recovery. Omission means `none`. Imported events and unbounded local events cannot declare recovery.

The stable event ID, maximum attempts, and recovery mode are copied into each outbox row when its producing action or consumer commits. A later source change never retroactively enables, disables, or otherwise reinterprets an already committed instance. Existing rows upgraded from 0.25 remain `none`, including rows already in terminal disposition.

## Isolated authority

Only an authenticated database identity directly granted the isolated `modellang_publication_recovery` role may invoke publication recovery. Application, gateway, dispatcher, consumer, consumer-recovery, owner, model-principal, and ordinary caller identities receive no publication-recovery authority. The role has execute-only access to the recovery function and no table-read, table-write, claim, acknowledgement, release, failure-recording, consumer, action, or query authority.

The function accepts only the private outbox UUID and a bounded reason code. It derives stable event identity, eligibility, disposition, counts, prior error, generation, and operator identity from trusted database state.

## Atomic recovery transition

Recovery locks the selected outbox row and succeeds only when its copied recovery mode is `manual` and its disposition is `deadLetter`. Missing, pending, published, ineligible, or otherwise invalid state fails closed with `ML_PUBLICATION_RECOVERY_STATE`.

One successful transaction atomically:

- changes `deadLetter` to `pending`;
- resets the current-cycle publication failure count to zero;
- preserves the monotonic total publication failure count;
- increments the recovery generation;
- clears terminal time and any lease;
- records the recovery time; and
- appends immutable private audit with outbox and stable-event identity, generation, prior cycle count, total count, prior bounded error code, bounded reason code, authenticated database principal, and occurrence time.

Rollback preserves the terminal row and appends no audit. Concurrent recovery and dispatcher claim serialize through the outbox row: the terminal row is not claimable before recovery commits, and normal claiming may occur only afterward.

## Dispatcher and broker boundary

Recovery grants no dispatcher authority and performs no claim. After recovery, a separately authorized dispatcher may claim the row through the ordinary lease path, publish through a host-owned broker, and acknowledge or record a new explicit failure. The next failure begins at current-cycle count one while total failures remain monotonic. A later terminal cycle may be recovered with the next generation.

ModelLang never performs network publication, broker acknowledgement, polling, redrive, message lookup, reconstruction, movement, destination selection, retry timing, backoff, or alerting. Private `deadLetter` and `recovered` state prove only PostgreSQL-local recorded transitions.

## Privacy and evolution

Runtime outbox rows, payloads, lease tokens, attempts, current and total counts, errors, dispositions, terminal/recovery times, generations, reasons, operators, audit rows, and recovery outcomes remain absent from operation, capability, UI, HTTP, event-instance, and agent-facing contracts. Event manifest v5 and engineering semantic manifest v10 expose only the static declared recovery eligibility.

IR18 preserves `none` or `manual` in each bounded event publication policy. IR17 bounded policies that omit recovery normalize to `none`; IR9 through IR17 remain accepted evolution baselines for IR18 current input. Adding, removing, or changing recovery on an existing stable event requires reviewed acknowledgement.

`016_upgrade_0_26.sql` is baseline checked and idempotent. It installs copied recovery eligibility, monotonic totals, generations, immutable private audit, the isolated role and execute-only function, and current producers/grants without fabricating recovery, operator identity, audit, publication, claim, lease, or broker history.
