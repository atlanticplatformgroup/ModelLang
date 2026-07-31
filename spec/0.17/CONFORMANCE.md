# ModelLang 0.17 applicability conformance

The 0.17 implementation is conformant when:

1. All 0.16 language, enforcement, transport, UI, workflow, semantic, provenance, and evolution tests continue to pass.
2. `.model` grammar, canonical IR9, operation manifest v2, UI manifest v2, engineering semantic manifest v1, and migration authorities remain unchanged.
3. Decision plan v1 is deterministic, schema-valid, internal, expression-bearing, and the one generated input to both applicability and execution decisions.
4. Capability manifest v1 is deterministic, schema-valid, filtered, expression-free, current-state-free, and explicitly non-authoritative.
5. Applicability requires authenticated caller context and never accepts caller identity from request data.
6. Applicability performs no model mutation and writes no action-audit row.
7. Authorization failure and missing action entity inputs return indistinguishable `denied` projections with no revision; action/query execution also projects missing callable entity references as authorization failure.
8. The first failed ordered requirement returns `notApplicable`; it never becomes authorization denial.
9. Explanations contain only the expected category and a rule ID allowlisted by the public capability contract.
10. `applicable` is true exactly for status `applicable`, and every response declares `authority: "none"`.
11. `stale` is returned only for an explicit expected-revision mismatch after authorization succeeds.
12. Execution loads and locks current authoritative state, re-evaluates authorization and requirements, compares an explicit revision, and applies the effect in one transaction.
13. A matching applicability revision cannot bypass execution checks and is not an authorization credential.
14. HTTP uses separate stable-ID applicability routes, strict quoted `If-Match`, closed decision validation, safe ETag projection, and typed stale errors.
15. Generated PostgreSQL, server, gateway, browser client, UI, and workflow helpers preserve the discovery/applicability/execution separation.
16. Live Procurement coverage proves denial/absence indistinguishability, requirement projection, purity, explicit stale comparison, and successful execution after fresh re-evaluation.
