# ModelLang 0.23 — Normative Language

Status: normative specification for the 0.23 reference compiler.

ModelLang 0.23 consists of the complete [ModelLang 0.22 language](../0.22/LANGUAGE.md) plus an optional bounded consumer failure policy and the [durable delivery-disposition contract](./CONSUMER_FAILURES.md).

A consumer may declare a retry limit after its requirements and before its effect:

```modellang
consumer observeApproval on RequestApproved(payload request: PurchaseRequest) -> PurchaseRequest {
  authorize true;
  require approved: request.status == RequestStatus.APPROVED;
  retry maxAttempts 3;
  update request { approvalObserved = true; }
  emit ApprovalObserved;
}
```

`maxAttempts` is an integer from 1 through 1000. It counts durably recorded failed handler deliveries for one stable consumer ID and source event instance ID. When omitted, the released 0.22 unbounded-retry behavior is preserved.

Version 0.23 advances canonical IR to IR15, engineering semantic manifest to v7, and semantic diff to v8. Event manifest v3, operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, event envelope v2, and stable HTTP routes remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, event-chain, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.23 differs, this version takes precedence.
