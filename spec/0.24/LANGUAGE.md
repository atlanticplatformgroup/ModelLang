# ModelLang 0.24 — Normative Language

Status: normative specification for the 0.24 reference compiler.

ModelLang 0.24 consists of the complete [ModelLang 0.23 language](../0.23/LANGUAGE.md) plus opt-in audited manual recovery for terminal consumer failures and the [private recovery contract](./CONSUMER_RECOVERY.md).

A bounded consumer may declare manual recovery after its retry policy and before its effect:

```modellang
consumer observeApproval on RequestApproved(payload request: PurchaseRequest) -> PurchaseRequest {
  authorize true;
  require approved: request.status == RequestStatus.APPROVED;
  retry maxAttempts 3;
  recovery manual;
  update request { approvalObserved = true; }
  emit ApprovalObserved;
}
```

`recovery manual;` is valid only with `retry maxAttempts N;`. Omission means terminal failure cannot be reopened through the generated recovery boundary. Recovery changes private delivery eligibility only; it does not acknowledge, requeue, move, reconstruct, or redeliver a broker message and grants no handler authority.

Version 0.24 advances canonical IR to IR16, engineering semantic manifest to v8, and semantic diff to v9. Event manifest v3, operation manifest v4, capability manifest v3, UI manifest v4, decision plan v2, event envelope v2, and stable HTTP routes remain unchanged.

All locked identity, authorization, applicability, workflow, reliable-command, transactional-event, reliable-consumer, event-chain, failure-disposition, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.24 differs, this version takes precedence.
