# ModelLang 0.34 conformance

An implementation conforms when it satisfies 0.33 conformance and:

1. parses zero through 16 named `sort` clauses after `orderBy` and before `limit`;
2. treats the required `orderBy` as the profile named `default` and rejects an authored profile with that reserved name;
3. rejects duplicate profile names, a conflicting query parameter named `sort`, unknown fields, non-source aliases, non-direct paths, optional fields, and more than 16 profiles;
4. records each profile's query-scoped stable identity, field identity, direction, and ascending identity tie-breaker in IR23;
5. adds an optional closed `sort` callable input only to queries that declare named profiles, with omission selecting `default`;
6. rejects every input other than `default` or an exact authored profile name before query execution;
7. emits only statically compiled ordering and keyset branches and emits no dynamic SQL or caller-selected field/direction expression;
8. preserves query authorization, row policy, projection disclosure, fixed limit, and ascending identity tie-breaker under every profile;
9. propagates the closed profile contract through TypeScript, operation manifest, OpenAPI, HTTP validation, UI descriptors, and engineering semantics;
10. binds a paginated cursor to the selected profile, order-field identity, direction, principal, filters, and query revision, rejecting cross-profile reuse as stale;
11. classifies profile addition as additive and profile removal or field/direction change as breaking;
12. accepts IR9 through IR22 as no-profile evolution baselines without fabricating sorting inputs;
13. emits IR23, operation manifest v9, capability manifest v8, UI manifest v9, semantic manifest/profile v15, semantic diff v16, and generator profile `/18`; and
14. preserves all locked earlier safety, privacy, deterministic generation, pagination, evolution, and privilege semantics.
