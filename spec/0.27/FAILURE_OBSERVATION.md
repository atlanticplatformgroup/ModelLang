# ModelLang 0.27 private terminal-failure observation

Status: normative.

## Separate observation authority

Only an authenticated database identity directly granted `modellang_failure_observer` may inspect terminal publication or consumer failures. The observer role is non-login and execute-only. It receives no table access and no application, gateway, dispatcher, consumer, consumer-recovery, publication-recovery, action, query, claim, acknowledgement, release, or failure-recording authority. Recovery roles receive no observation authority.

Observation discovers private terminal work; it grants no authority to reopen or dispatch it. Consumer recovery, publication recovery, and dispatcher claim remain separate authenticated operations.

## Minimal private projection

Each observation item contains only its kind, stable event or consumer contract identity, private event-instance identity, current and total failure counts, declared maximum, bounded last error code, terminal time, recovery generation, and static recovery eligibility copied or derived from the current generated contract.

The projection excludes payloads, model principals, database principals, correlation and causation, decisions and evidence, receipts, idempotency keys, fingerprints, stored responses, handler results, leases, destinations, and broker details. Observation functions and their typed adapter are server-only and are not HTTP, MCP, capability, UI, operation, or agent contracts.

## Bounded cursor traversal

Publication rows are ordered by terminal time and private outbox UUID. Consumer rows are ordered by terminal time, stable consumer ID, and private source-event UUID. Page size is explicitly bounded from 1 through 100. The first call establishes a database-generated snapshot cutoff; every continuation cursor carries that same cutoff and the last emitted ordering tuple.

Rows becoming terminal after the cutoff cannot enter that traversal. A continuation is keyset based and emits no row at or before its cursor. Rows recovered or otherwise no longer terminal disappear from later pages rather than being represented by stale state. Cursors are private continuation state, are validated as a complete tuple, and grant no authority.

## Immutable observation audit

Every successful page request atomically appends private immutable audit containing the authenticated database principal, failure kind, snapshot cutoff, private continuation position when present, requested limit, returned count, whether another page existed, and occurrence time. A rejected or rolled-back request appends no audit. Audit tables are not readable through the observer adapter.

## Upgrade

`017_upgrade_0_27.sql` is baseline checked and idempotent. It creates the isolated role, private audit, indexes, observation functions, and least-privilege grants without changing existing consumer failure, outbox, recovery, domain, receipt, decision, or broker state and without fabricating observation history.
