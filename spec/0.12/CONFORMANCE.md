# ModelLang 0.12 gateway-identity conformance

The 0.12 implementation is conformant when:

1. All 0.11 language, transport, enforcement, migration, and golden-artifact tests continue to pass.
2. Source grammar, canonical IR9, operation manifest v1, stable HTTP routes, and public operation shapes remain unchanged.
3. Generated PostgreSQL roles include a non-login `modellang_gateway` role that inherits callable `modellang_app` authority but never owner authority.
4. Gateway bindings are owner-controlled `(issuer, subject)` mappings and are inaccessible to runtime roles.
5. Only a login explicitly provisioned as a gateway member can activate gateway resolution.
6. The generated server adapter accepts verified issuer/subject claims and exposes no ModelLang principal-ID input.
7. Each gateway operation begins, binds, executes, and commits or rolls back on one acquired connection before release.
8. Missing and unknown gateway identities fail closed as typed identity-binding errors.
9. Commit, rollback, forced pool reuse, and concurrent requests cannot carry one caller identity into another operation.
10. Direct-login mode continues to bind exclusively from `session_user`, and forged gateway configuration cannot override it.
11. Gateway action audit rows record database principal, resolved model principal, issuer, and subject; direct rows keep issuer and subject symmetrically null.
12. Browser artifacts, OpenAPI, and the transport-neutral manifest contain no SQL, database roles, gateway credentials, or caller-selection field.
13. Existing 0.11 installations have an idempotent transactional upgrade artifact, and generated safe migrations include the same internal upgrade before callable redeployment.
14. The Procurement HTTP integration executes with one shared gateway pool and proves authorization, workflow behavior, typed errors, caller-spoofing rejection, audit provenance, rollback cleanup, and pooled identity isolation.
