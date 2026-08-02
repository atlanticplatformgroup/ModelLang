# ModelLang 0.19 reliable command execution

Status: normative.

## 1. Declaration and execution metadata

An action opts into the version-1 reliable command profile with one declaration after its `authorize` and `require` rules and before its effect:

```modellang
action openRequest @stableId("act_...")(
  caller actor: User,
  amount: Money<USD>
) -> PurchaseRequest {
  authorize Role.EMPLOYEE in actor.roles;
  require positive_amount: amount > USD 0;
  idempotency required;
  create PurchaseRequest { requester = actor; amount = amount; }
}
```

The idempotency key, correlation ID, and causation ID are execution metadata. They are not model parameters, cannot be referenced by expressions or effects, do not appear in entity values, and never replace authenticated caller identity. Applicability accepts none of this metadata and never reserves a key.

`required` is the only idempotency mode in version 1. A marked action rejects execution without a key. An unmarked action rejects a supplied key so callers cannot mistakenly assume retry safety. Keys and correlation identifiers are 1–128 characters and match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`. Causation is optional. For a reliable command, an omitted correlation ID defaults to the idempotency key. For an unmarked action, an HTTP boundary generates the correlation UUID so it can echo it; direct PostgreSQL execution defaults it inside the database.

## 2. Receipt identity and request fingerprint

Receipts are scoped by authenticated principal ID, stable action ID, and idempotency key. Database login names, gateway token text, editable declaration names, and source expressions are not part of receipt identity.

Before evaluating authorization or mutating state, execution computes a SHA-256 request fingerprint from:

- the stable action ID;
- every callable argument keyed by stable parameter ID and encoded as its canonical database value;
- the explicit expected revision, including null;
- the resolved correlation ID and causation ID.

The receipt separately stores the model ID, model version, and source hash. Reuse of a receipt key with a different request fingerprint or source hash fails closed with `ML_IDEMPOTENCY_CONFLICT`. No evaluated authorization fact, role snapshot, expression, token, or arbitrary reason is included.

## 3. First execution, concurrency, and replay

The first execution claims a private receipt in the mutation transaction. Concurrent executions of the same receipt identity serialize on the database uniqueness boundary. Exactly one execution may evaluate guards and produce effects; a concurrent equivalent request waits and then replays its committed result. If the first transaction rolls back, its claim, effect, audit row, and evidence all disappear, so the key may be used again.

On success the receipt stores the exact JSON result, target ID, model/source identity, request fingerprint, correlation and causation IDs, and its action-audit ID. The action audit and decision evidence link back to the receipt.

An equivalent retry by the same authenticated principal returns the stored result. It does not re-evaluate current authorization, preconditions, revisions, or entity state because replay is not a new domain effect. It grants no authority for any other action. A different principal cannot discover or replay the receipt because principal identity is part of its private key.

Failed identity resolution, validation, authorization, revision, precondition, invariant, workflow, exclusion, or effect execution leaves no durable receipt. Version and fingerprint conflicts do not reveal the stored result or the conflicting field.

## 4. Transport and public projection

HTTP execution uses `Idempotency-Key`, `X-Correlation-ID`, and `X-Causation-ID`. Successful responses echo the resolved `X-Correlation-ID`. The JSON operation input and output shapes and route paths remain unchanged. Generated direct, gateway, HTTP, browser, and UI clients carry the metadata through execution options.

Operation manifest v3, capability manifest v2, and UI manifest v3 identify which actions require idempotency. This reliability metadata is a filtered static contract: it contains no keys, receipts, current state, decision expressions, evidence, or capability tokens. `ML_IDEMPOTENCY_CONFLICT` maps to a stable HTTP 409 problem. Missing, malformed, or unsupported keys map to validation failures.

## 5. Storage, confidentiality, and retention

Receipts live in the owner-controlled internal schema. Application and gateway roles have no table access. Keys, correlations, stored results, and principal/action associations may be sensitive even though policy facts are omitted. Encryption, export, legal hold, deletion, and a concrete retention duration remain deployment governance responsibilities.

A deployment must retain a receipt for at least its advertised client retry window. Deleting a receipt permits that key to execute again and is therefore an administrative semantic operation, not routine application behavior. The reference compiler generates no automatic receipt deletion.

## 6. Evolution

IR11 retains the idempotency declaration. Semantic diff v4 classifies idempotency changes by stable action identity. Safe migration rejects adding or removing required idempotency on an existing action; reviewed migration requires explicit acknowledgement and installs receipt infrastructure before redeploying actions.

`009_upgrade_0_19.sql` is baseline checked and idempotently installs the private receipt and audit-correlation boundary before redeploying actions and grants. Released IR10 remains accepted as an evolution baseline when the current source compiles to IR11.
