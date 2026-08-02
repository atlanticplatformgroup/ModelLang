# ModelLang 0.21 — Normative Language

Status: normative specification for the 0.21 reference compiler.

ModelLang 0.21 consists of the complete [ModelLang 0.20 language](../0.20/LANGUAGE.md) plus imported event-source contracts, stable typed event consumers, and the [reliable consumption contract](./EVENT_CONSUMERS.md).

A consumer is declared as:

```modellang
consumer observeApproval @stableId("con_...") on RequestApproved(
  payload request: PurchaseRequest
) -> PurchaseRequest {
  authorize true;
  require approved: request.status == RequestStatus.APPROVED;
  update request { approvalObserved = true; }
}
```

The source event must be declared and its payload entity must equal the consumer payload parameter type. An event may optionally bind an imported source contract with `from "model:Name" version "x.y.z" sourceHash "sha256:..."`; imported contracts may be consumed but not emitted.

Version 0.21 advances canonical IR to IR13, engineering semantic manifest to v5, event manifest to v2, and semantic diff to v6. Operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, event delivery envelope v1, and stable HTTP routes remain unchanged because consumers are a private server boundary, not public application operations.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.21 differs, this version takes precedence.
