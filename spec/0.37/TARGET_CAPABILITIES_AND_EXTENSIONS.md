# Target capability profiles and extension ledger

## Extension declaration

```modellang
extension supplierRiskReview @stableId("ext_...")(
  request: PurchaseRequest,
  requestedBy: User
) -> Boolean {
  owner "Procurement Platform";
  implementation externalService at "supplier-risk/review";
  reads PurchaseRequest, User;
  writes none;
  calls "supplier-risk-api";
  emits none;
  deterministic false;
  idempotent true;
  retry hostManaged;
  authorization serviceIdentity;
  tests "contracts/supplier-risk-review";
  reason "Supplier risk scoring depends on a separately owned external service.";
  promote "Promote when a portable deterministic risk policy can be represented in the core.";
}
```

Clauses are closed and ordered. Parameters and the result may use supported scalar, enum, money, or entity types; set-valued contracts are excluded from v1. Parameters may be optional but may not be `caller` parameters. Result optionality is explicit. Stable extension IDs use `ext_[0-9a-f]{32}` and lower to `extension:<stable-id>`.

Implementation targets are `typescript`, `java`, `rust`, `python`, `workflow`, or `externalService`. Reads and writes resolve to declared entity IDs. Emissions resolve to locally owned event IDs; imported events cannot be emitted. External-system and test strings must be non-empty and unique. At least one test obligation is required. Host-managed retry requires an idempotent contract. An extension that writes state or emits an event cannot declare authorization `none`.

The compiler does not verify that the implementation file, service, or test exists and does not invoke, link, scaffold, deploy, or authorize it. `execution: externalDeclarationOnly` is preserved in IR, semantic metadata, and the ledger.

## Extension ledger

`extensions.json` is engineering-only, non-public, and non-executable. It copies the exact typed contract, declared effects, governance metadata, reliability, authorization context, source span, and stable identity from IR26. Its summary counts declared and externally implemented extensions and always reports zero generated implementations.

The ledger is assurance metadata, not a callable registry, service locator, capability token, deployment record, or proof that the host implementation conforms. Public operation, capability, OpenAPI, and UI manifests omit extensions.

## Target capability report

`target-capabilities.json` identifies `target:postgresql-http-ui/1`, generator profile, model/source identity, IR version, required semantic capabilities, support mode, and enforcement concerns. Native core features use `support: native`. Extension behavior uses `support: externalImplementationRequired` and produces one gap per stable extension ID.

The report is `complete` only when every required model capability is native. A model with extensions is `requiresExternalImplementations`. The report grants no authority and cannot convert an extension into generated behavior.

## Evolution

Extension addition is additive assurance metadata. Removal requires review because it may represent removed behavior or promotion into the core. Stable-ID rename is identity preserving. Typed contract changes are breaking. Effect, reliability, or authorization changes require review and carry persistence risk when declared writes are involved. Owner, implementation, tests, rationale, or promotion-criterion changes require review.

IR9 through IR25 normalize to an empty extension set during evolution analysis. No historical extension obligations are invented.
