# ModelLang 0.18 reusable policies and durable decision evidence

Status: normative.

## 1. Policy declarations

A version-1 policy is a pure Boolean decision with typed parameters and one or more named `allow` branches:

```modellang
policy ApprovalAuthority @stableId("pol_...")(
  actor: User,
  request: PurchaseRequest
) {
  allow manager @stableId("pbr_..."):
    request.amount <= USD 10000 and Role.MANAGER in actor.roles;
  allow finance @stableId("pbr_..."):
    request.amount > USD 10000 and Role.FINANCE in actor.roles;
}
```

Policies and branches are durable declarations. Their IDs use `pol_` and `pbr_` stable-ID namespaces. Parameter and branch names are lexical; stable IDs, not editable names, carry semantic continuity through rename analysis and durable evidence.

Policy parameters may use the same required scalar, enum, entity, and `Money<C>` value types supported for ordinary operation parameters. Version 1 does not support optional or set-valued policy parameters. Policy arguments are type checked, and nullable arguments cannot bind required policy parameters.

Policies contain expressions only. They have no effects, caller binding, database syntax, callbacks, dynamic evaluation, or external operations. Calls may compose policies, but the call graph must be acyclic. Recursion is rejected at compilation.

## 2. Closed decision semantics

Every branch is evaluated against the same bound arguments in declaration order. A branch matches only when its expression is exactly true; false and null do not match.

The policy result is true only when exactly one branch matches. Zero matches returns false. More than one match is ambiguous and fails closed as false. Declaration order never selects a winner and therefore cannot silently turn overlapping authority into evidence.

The unique successful branch is the policy's exact authority. It is represented by the branch stable ID, never inferred from expression text, current role snapshots, backend messages, or branch position.

Policy calls are Boolean expressions and may be used by `authorize` and named `require` rules. To make executed authority exact, an action authorization may contain at most one top-level policy call, and that call must occur positively as a conjunct. `or`, `not`, and multiple policy calls in action authorization are rejected. Legacy authorization with no policy call remains valid and records no exact policy authority.

Queries may consume policies as pure Boolean predicates. Query decisions do not produce action execution evidence.

## 3. Canonical representations

IR10 retains policy declarations, typed parameters, stable branches, branch expressions, and identity-based `policyCall` expressions. This cannot be represented faithfully by IR9 without erasing source semantics, so the canonical IR version advances.

Decision plan v2 is the single internal enforcement input for applicability and execution. It adds the closed policy graph, branch expressions, evaluation/null/ambiguity behavior, per-rule policy references, and the action's authority-bearing policy ID. PostgreSQL applicability and action functions compile from that same plan.

Engineering semantic manifest v2 reports every policy, branch, typed parameter, stable use site, and applicability/execution/evidence coverage. Enforcement artifacts map policies and branches to generated decision and action enforcement points. Semantic diff v3 compares policies and branches by stable ID; renames preserve identity, while signatures, branch additions/removals, and branch-expression changes are classified for guarded migration review.

## 4. Applicability and public projection

Capability manifest v1 and the HTTP applicability response remain unchanged. Public explanations continue to expose only the action authorization, requirement, or revision rule IDs allowlisted by the capability manifest. They do not expose policy IDs, branch IDs, expressions, evaluated facts, current values, SQL details, or traces.

Every applicability response continues to declare `authority: "none"`. A successful response, policy ID, branch ID, decision revision, or evidence record is not a capability token and grants no authority. Missing and invisible entity references retain the authorization-denial projection. `stale` still requires an explicit expected revision.

## 5. Transactional durable evidence

On successful action execution, the PostgreSQL profile writes one private action-audit row after the effect and before commit. The row records:

- stable action ID and authenticated database/model principal provenance;
- model ID, model version, and exact source hash;
- stable authorization rule ID and executed outcome;
- the authority-bearing policy ID and exact branch ID when the action uses a policy;
- a closed JSON evidence object containing version, executed outcome, model/source identity, action ID, authorization result, and ordered passed requirement rule IDs and policy references.

Evidence never contains arbitrary reason strings, expression source, evaluated field values, role snapshots, SQL names, or a full trace. Actions without an authority policy record null policy/authority IDs while still recording rule and model evidence.

The effect, action audit, and evidence insert share one transaction. Any later transaction rollback removes all three. Failed authorization, requirements, revisions, effects, invariants, and workflow checks write no successful evidence.

Evidence storage is in the owner-controlled internal schema. Application and gateway roles receive no table access. Evidence may contain security-relevant authority metadata even without evaluated facts; confidentiality, retention, export, legal hold, and deletion schedules remain deployment governance responsibilities rather than public application contracts.

## 6. Evolution

Fresh installations include nullable evidence columns so historical evidence-unknown rows can coexist with complete 0.18 rows. `008_upgrade_0_18.sql` is baseline checked and idempotently adds the internal evidence contract, then redeploys decisions, actions, and grants without changing domain data or migration history.

Safe and reviewed migrations install the evidence boundary before redeploying 0.18 actions. An IR9 released baseline is accepted when the current input is IR10. The safe planner permits additive unused policies and identity-preserving policy/branch renames, but rejects existing policy semantics or action authority changes. The reviewed planner requires stable-ID semantic-diff acknowledgements for non-additive policy changes and retains its existing transactional rebuild and rollback rules.

Historical rows created before 0.18 remain explicitly evidence-unknown; the compiler does not fabricate past exact authority from stored role snapshots.
