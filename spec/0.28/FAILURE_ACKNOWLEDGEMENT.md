# ModelLang 0.28 private terminal-failure acknowledgement

Status: normative.

## Separate acknowledgement authority

Only an authenticated database identity directly granted `modellang_failure_acknowledger` may acknowledge a current terminal publication or consumer failure. The acknowledger role is non-login and execute-only. It receives no table access and no observer, application, gateway, dispatcher, consumer, consumer-recovery, publication-recovery, action, query, claim, publication, or failure-recording authority. No other generated runtime role receives acknowledgement authority.

Acknowledgement records that one current PostgreSQL-local terminal recovery cycle was seen. It does not recover, claim, dispatch, publish, consume, assign, approve, or change broker or domain state.

## Trusted terminal-cycle identity

A publication terminal cycle is identified by private outbox UUID plus the recovery generation stored on the locked outbox row. A consumer terminal cycle is identified by stable consumer ID, private source-event UUID, and the recovery generation stored on the locked failure row.

The caller supplies only the private event identity and a bounded stable reason code matching `^[A-Z][A-Z0-9_]{0,63}$`. For a consumer acknowledgement the stable consumer ID is part of that private event identity. Current disposition, recovery generation, stable event or consumer contract identity, and authenticated database operator are derived from trusted state. Caller-supplied generation, disposition, contract identity, or operator values are not accepted.

## Atomic acknowledgement

Acknowledgement succeeds only while the selected row is currently `deadLetter`. Missing, malformed, pending, ready, resolved, published, recovered, or otherwise non-terminal state fails closed. A successful transaction appends one immutable private audit row containing the terminal-cycle identity, stable contract identity, bounded reason code, authenticated database principal, and occurrence time.

Acknowledgement changes no failure count, total count, disposition, recovery eligibility, claim eligibility, lease, inbox, outbox, domain row, decision evidence, receipt, or broker state. Rollback removes the acknowledgement audit and leaves all other state unchanged.

A uniqueness boundary permits one acknowledgement per terminal recovery generation. Equivalent concurrent attempts serialize against the same failure state and commit one row. A later attempt for that current generation returns the closed `alreadyAcknowledged` outcome without disclosing the stored reason or operator.

## Recovery serialization and later cycles

Publication acknowledgement locks the same outbox row as publication recovery. Consumer acknowledgement acquires the same consumer/event transaction lock and failure-row lock as consumer recovery and failure handling. If acknowledgement commits first, its immutable history remains and recovery may proceed normally. If recovery commits first, acknowledgement fails because that generation is no longer terminal.

Recovery increments the generation. If the same event later becomes terminal again, its new current cycle begins unacknowledged and can receive one new acknowledgement without altering earlier history.

## Observation and privacy

The private observer projection adds only `acknowledged: Boolean`, computed for the row's current recovery generation. It exposes no acknowledgement reason, operator, occurrence time, audit identifier, or historical acknowledgement. The server-only `failure-acknowledgement.ts` adapter returns only a closed status and trusted recovery generation.

Acknowledgement functions, identities, reasons, operators, audits, and outcomes remain absent from operation, capability, UI, OpenAPI, HTTP, event, MCP, and agent-facing contracts. Acknowledgement records and observer booleans grant no recovery, dispatch, consumer, application, or broker authority.

## Upgrade

`018_upgrade_0_28.sql` is baseline checked and idempotent. It creates the isolated role, immutable private audit tables, acknowledgement functions, updated observer projection, and least-privilege grants without changing existing failure, recovery, outbox, inbox, domain, decision, receipt, observation, or broker state and without fabricating acknowledgement history.
