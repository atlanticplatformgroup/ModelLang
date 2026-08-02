# ModelLang 0.19 unstable reliable-command boundaries

The 0.19 contracts deliberately do not stabilize:

- optional or server-selected idempotency modes, client-generated key algorithms, bulk keys, or cross-action keys;
- failed-command receipts, asynchronous `inProgress` responses, cancellation, queueing, or leases;
- automatic receipt expiration, a universal retry window, deletion APIs, retention jobs, archival, or legal-hold policy;
- replay across a changed source hash, response-schema translation, or administrative receipt migration;
- public receipt lookup, stored-result inspection, key enumeration, evidence export, or replay-debug endpoints;
- signed receipts, delegated authority, capability tokens, reservations, or proof-carrying commands;
- event delivery, outbox processing, sagas, compensation, external effects, or general recovery workflows;
- MCP/agent generation or direct agent consumption of receipts, evidence, or internal decision plans;
- every boundary already listed as unstable in 0.18.

These omissions are intentional. Reliable command v1 closes synchronous duplicate execution for the bounded PostgreSQL profile without making receipts or evidence public capabilities.
