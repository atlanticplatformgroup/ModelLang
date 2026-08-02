# ModelLang 0.29 private terminal-failure self-claim

Status: normative.

## Separate claim authority

Only an authenticated database identity directly granted `modellang_failure_claimant` may claim a current terminal publication or consumer failure. The claimant role is non-login and execute-only. It receives no table access and no observer, acknowledger, application, gateway, dispatcher, consumer, consumer-recovery, publication-recovery, action, query, publication, or failure-recording authority. No other generated runtime role receives terminal-failure claim authority.

A claim records that one database operator became the first claimant for one current PostgreSQL-local terminal recovery cycle. It does not acknowledge, recover, dispatch, publish, consume, approve, transfer ownership, assign another operator, start a lease, or change broker or domain state.

## Trusted terminal-cycle and claimant identity

A publication terminal cycle is identified by private outbox UUID plus the recovery generation stored on the locked outbox row. A consumer terminal cycle is identified by stable consumer ID, private source-event UUID, and the recovery generation stored on the locked failure row.

The caller supplies only the private event identity. For a consumer claim the stable consumer ID is part of that private identity. Current disposition, recovery generation, stable event or consumer contract identity, and claimant database principal are derived from trusted state. Caller-supplied generation, disposition, contract identity, or claimant values are not accepted.

## Atomic first-writer claim

A claim succeeds only while the selected row is currently `deadLetter`. Missing, malformed, pending, ready, resolved, published, recovered, or otherwise non-terminal state fails closed. A successful transaction appends one immutable private claim row containing terminal-cycle identity, stable contract identity, authenticated database principal, and occurrence time.

Claiming changes no failure count, total count, disposition, recovery eligibility, dispatcher claim eligibility, lease, acknowledgement, inbox, outbox, domain row, decision evidence, receipt, or broker state. Rollback removes the claim row and leaves all other state unchanged.

A uniqueness boundary permits one claimant per terminal recovery generation. Equivalent concurrent attempts serialize against the same failure state and commit one row. Every later attempt for that current generation returns the closed `alreadyClaimed` outcome without disclosing the stored claimant or occurrence time. Claimant identity is immutable; release, reassignment, and delegation are not part of 0.29.

## Recovery serialization and later cycles

Publication claiming locks the same outbox row as publication recovery. Consumer claiming acquires the same consumer/event transaction lock and failure-row lock as consumer recovery and failure handling. If claiming commits first, its immutable history remains and recovery may proceed normally. If recovery commits first, claiming fails because that generation is no longer terminal.

Recovery increments the generation. If the same event later becomes terminal again, its new current cycle begins unclaimed and can receive one new first-writer claim without altering earlier history.

## Observation and privacy

The private observer projection adds only `claimed: Boolean`, computed for the row's current recovery generation. It exposes no claimant principal, occurrence time, claim identifier, or historical claim. The server-only `failure-claim.ts` adapter returns only a closed status and trusted recovery generation.

Claim functions, identities, claimants, records, and outcomes remain absent from operation, capability, UI, OpenAPI, HTTP, event, MCP, and agent-facing contracts. Claim records and observer booleans grant no acknowledgement, recovery, dispatch, consumer, application, or broker authority.

## Upgrade

`019_upgrade_0_29.sql` is baseline checked and idempotent. It creates the isolated role, immutable private claim tables, claim functions, updated observer projection, and least-privilege grants without changing existing failure, recovery, acknowledgement, outbox, inbox, domain, decision, receipt, observation, or broker state and without fabricating claim history.
