# ModelLang 0.25 — Normative Language

Status: normative specification for the 0.25 reference compiler.

ModelLang 0.25 consists of the complete [ModelLang 0.24 language](../0.24/LANGUAGE.md) plus opt-in bounded failure disposition for local transactional-event publication and the [private publication-failure contract](./PUBLICATION_FAILURES.md).

A local event may declare a bounded publication policy after its payload contract:

```modellang
event RequestApproved @stableId("evt_30d694c9a0a274dc79c6168e47d25968")
  payload PurchaseRequest retry maxAttempts 5;
```

Omission means unbounded publication retry. `retry maxAttempts N;` is valid only for locally produced events and `N` is an integer from 1 through 1000. The policy governs only failures explicitly recorded while holding the current private outbox lease. It does not acknowledge, publish, move, delete, route, delay, or reconstruct a broker message.

Version 0.25 advances canonical IR to IR17, event manifest to v4, engineering semantic manifest to v9, and semantic diff to v10. Operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, event envelope v2, and stable HTTP routes remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, event-chain, consumer-failure/recovery, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.25 differs, this version takes precedence.
