# ModelLang 0.22 — Normative Language

Status: normative specification for the 0.22 reference compiler.

ModelLang 0.22 consists of the complete [ModelLang 0.21 language](../0.21/LANGUAGE.md) plus ordered domain-event emission from stable typed consumers and the [transactional event-chain contract](./EVENT_CHAINS.md).

A consumer may emit local events after its one local effect:

```modellang
consumer observeApproval @stableId("con_...") on RequestApproved(
  payload request: PurchaseRequest
) -> PurchaseRequest {
  authorize true;
  require approved: request.status == RequestStatus.APPROVED;
  update request { approvalObserved = true; }
  emit ApprovalObserved;
}
```

The emitted event payload entity must equal the consumer result/effect entity. Imported events may be consumed but cannot be emitted. Multiple distinct emitted events retain source order as a durable producer-local ordinal.

Version 0.22 advances canonical IR to IR14, engineering semantic manifest to v6, event manifest to v3, semantic diff to v7, and event delivery envelope to v2. Operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, and stable HTTP routes remain unchanged because consumer chains are private server behavior, not public application operations.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.22 differs, this version takes precedence.
