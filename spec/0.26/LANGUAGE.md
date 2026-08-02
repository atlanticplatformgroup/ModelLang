# ModelLang 0.26 — Normative Language

Status: normative specification for the 0.26 reference compiler.

ModelLang 0.26 consists of the complete [ModelLang 0.25 language](../0.25/LANGUAGE.md) plus opt-in audited manual recovery for terminal local event-publication failures and the [private publication-recovery contract](./PUBLICATION_RECOVERY.md).

A local event with bounded publication failure may opt into manual recovery after its retry policy:

```modellang
event RequestApproved @stableId("evt_30d694c9a0a274dc79c6168e47d25968")
  payload PurchaseRequest retry maxAttempts 5 recovery manual;
```

Omission means that a terminal publication failure cannot be reopened through generated runtime authority. `recovery manual` is valid only for a locally produced event that also declares `retry maxAttempts N`. Recovery restores one private terminal outbox instance to normal claim eligibility; it does not publish, claim, acknowledge, reconstruct, route, delay, or move a broker message.

Version 0.26 advances canonical IR to IR18, event manifest to v5, engineering semantic manifest to v10, and semantic diff to v11. Operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, event envelope v2, and stable HTTP routes remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, event-chain, consumer-failure/recovery, publication-failure, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.26 differs, this version takes precedence.
