# ModelLang 0.17 authenticated applicability

Status: normative.

## 1. Separate contracts

Discovery, applicability, and execution are separate concepts:

1. Operation manifest v2 and UI manifest v2 describe static declared operations and presentation structure. Their presence does not assert current authorization or applicability.
2. Applicability is a pure authenticated query over current authoritative state for one declared action and its callable input.
3. Execution is the only operation that may apply the action effect. It re-evaluates the same generated decision plan inside the mutation transaction.

Applicability is defined for actions, not queries. A successful applicability result is advisory and grants no capability, token, lock, reservation, or authority.

## 2. Canonical decision plan

`decisions.json` is enforcement decision plan v1, generated from canonical IR9. It contains each action's callable parameters, authenticated caller parameter, authoritative entity loads, execution lock modes, normalized authorization expression, ordered `require` expressions, absence projection, and revision components.

The PostgreSQL applicability functions and mutation functions are generated from this one plan. The applicability path reads without changing model state or action audit. The execution path obtains the declared locks, reloads authoritative state, and evaluates authorization and requirements before applying effects. A prior applicability response is never accepted as evidence that these checks may be skipped.

The decision plan is an internal enforcement artifact. It is not a browser, agent, or general application contract.

## 3. Outcomes and safe explanations

An applicability decision is a closed object with the stable action `operationId`, `status`, matching `applicable` boolean, and `authority: "none"`. The statuses are:

- `applicable`: authorization and every requirement currently pass;
- `denied`: authorization fails, or an entity needed to evaluate the action is not visible under the default absence projection;
- `notApplicable`: authorization passes and the first ordered action requirement fails;
- `stale`: authorization passes and an explicitly supplied expected revision differs from current authoritative state.

Authorization is evaluated before requirements. `authorize` failure therefore means `denied`; `require` failure means `notApplicable`. Explanations contain only a category and a stable rule ID approved by capability manifest v1. They contain no expression, current value, SQL name, lock detail, or arbitrary backend message.

By default, a referenced entity that cannot be loaded is projected exactly as authorization denial: the response has no revision and uses the action's authorization rule ID. Entity invisibility is therefore indistinguishable from absence at this boundary. The same default applies when action or query execution cannot load a callable entity reference: it raises the operation's authorization failure rather than a distinct entity-not-found failure. An unknown HTTP operation route remains a transport-level not-found response.

## 4. Explicit revisions

A revision is an opaque backend-produced string. It is returned only when authorization permits state disclosure. A decision can be `stale` only when the caller supplied an explicit expected revision for comparison; omission of that value can never produce `stale`.

HTTP carries the explicit value as one quoted `If-Match` entity tag. Generated TypeScript clients expose it as `expectedRevision`. Malformed values fail input validation.

The current PostgreSQL profile derives revisions from the model source hash, stable action and parameter IDs, normalized callable values, authenticated principal identity, and PostgreSQL authoritative row versions. This algorithm is backend-specific and intentionally opaque outside the server boundary. A revision is not a bearer credential and grants no authority.

Execution compares an explicit expected revision only after current rows are locked/loaded and current authorization passes. Whether the comparison succeeds or fails, execution has re-evaluated current authorization. A matching revision does not suppress requirement, workflow, invariant, or effect checks.

## 5. Filtered public capability contract

`capabilities.json` is capability manifest v1 and is derived from operation manifest v2 plus enforcement decision plan v1. It is a filtered static application contract, never a serialization of compiler engineering semantics.

For each action it exposes stable operation/input IDs, the fixed outcome vocabulary, safe authorization/requirement/revision rule IDs, and opaque-revision behavior. It explicitly declares that it contains no expressions or current state and grants no authority. Runtime decision responses are validated against this allowlist before crossing HTTP.

The browser-safe client, UI executor, and workflow executor provide separate applicability and execution methods. Structural workflow availability remains discovery only; applications may combine it with authenticated applicability but must still handle execution-time denial, non-applicability, stale state, conflicts, and invariant failures.
