# ModelLang 0.18 policy-decision conformance

The 0.18 implementation is conformant when:

1. All 0.17 language, enforcement, transport, UI, workflow, semantic, provenance, and evolution guarantees continue to pass.
2. Policies and branches have stable semantic identities, typed required parameters, pure Boolean expressions, no side effects, and an acyclic call graph.
3. A policy succeeds for exactly one true branch; zero or multiple branches fail closed and null never grants authority.
4. Action authorization permits at most one positive conjunctive policy call, making a successful authority branch exact without expression-text inference.
5. IR10, decision plan v2, semantic manifest v2, enforcement maps, and semantic diff v3 preserve policy identity, composition, branch semantics, uses, and coverage.
6. Applicability and execution evaluate the same generated plan against authoritative state; execution still locks, reloads, and re-evaluates inside the mutation transaction.
7. Public capability manifest v1, operation manifest v2, UI manifest v2, HTTP routes, and applicability response shapes remain unchanged and policy-free.
8. Public decisions retain `authority: "none"`, safe allowlisted action-rule explanations, absence denial projection, and explicit-only stale comparison.
9. Successful action execution records model/source identity, action and authorization rule IDs, executed outcome, and exact policy/branch authority when present.
10. Durable evidence contains no evaluated facts, arbitrary reasons, internal expressions, SQL details, or full traces and is inaccessible to application principals.
11. Effect, audit, and evidence are atomic: rollback removes all of them and failed actions write no success evidence.
12. Procurement live coverage distinguishes manager authority from finance authority even while the contextual role-set snapshot remains broader.
13. The baseline-checked 0.18 upgrade is idempotent, and safe/reviewed migrations install evidence infrastructure before redeploying callables.
14. Policy renames and semantic changes participate in stable-ID diffing and both guarded migration authorities.
