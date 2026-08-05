# ModelLang 0.44 bounded public decision traces

## Scope

Public decision trace v1 explains one current authenticated applicability evaluation for one exact declared action/input. It is available through authenticated `POST /agent/decision-traces` and the read-only MCP tool `modellang_public_decision_trace`. Both surfaces use the same exact generated input and output schemas and the same authoritative applicability evaluator used by action preflight and execution.

The trace scope is only `applicability`. It does not execute an action, observe execution, persist evidence, publish a historical decision, or claim a complete decision trace.

## Input and evaluation

The request is a closed object containing one exact action candidate: declared stable operation ID, schema-valid action input, and an optional opaque revision. Identity is accepted only from the authenticated host context. Caller command metadata and delegated capability credentials are rejected.

Evaluation preserves the authoritative order and short-circuit behavior:

1. the action authorization rule is `passed` or `failed`;
2. declared requirement rules are reported in source order as `passed`, `failed`, or `notEvaluated`;
3. the revision rule is `notRequested`, `matched`, `mismatched`, or `notEvaluated`.

An authorization denial marks every requirement and revision outcome `notEvaluated`. A requirement failure marks later requirements and revision `notEvaluated`. A stale supplied revision follows successful authorization and requirements and reports `mismatched`. An applicable decision reports `notRequested` when no revision was supplied and `matched` otherwise.

The embedded `decision` retains the exact existing applicability outcome: `applicable`, `denied`, `notApplicable`, or `stale`, `authority: "none"`, the opaque current revision where permitted, and the safe explanation rule identity for an unavailable outcome.

## Disclosure and evidence boundary

The response may disclose only stable model/action identity, safe authorization/requirement/revision rule identities, categorical outcomes, opaque revision, transport time, and explicit closure metadata. It must not disclose:

- the supplied action input or values read while evaluating it;
- authenticated principal, issuer, subject, role, or other identity values;
- policy identities, authority-branch identities, expressions, SQL, or internal evaluator data;
- private `action_audit.decision_evidence`, query evidence, command receipts, event/consumer evidence, or execution results.

Trace assembly is side-effect-free and writes no action-audit row. Existing private successful-execution evidence remains private and is not transformed into this public contract.

## Freshness and authority

Every trace is point-in-time, carries `maxAgeSeconds: 0`, requires revalidation before reuse, and is returned with no-store transport metadata. An MCP result includes the unchanged envelope as a distinct embedded resource whose URI contains no request input.

Catalog discovery, MCP discovery, the trace, its rule outcomes, and its opaque revision grant no authority. Action execution must authenticate again and re-run all current runtime authorization, row policy, precondition, revision, workflow, lock, invariant, and validation rules. Actions, current-state resources, task packets, delegated capabilities, and public traces remain distinct contracts.

