# ModelLang 0.35 conformance

An implementation conforms when it satisfies 0.34 conformance and:

1. parses optional `redactable` projection members and zero through 32 `disclose path when expression;` clauses after `where` and before `orderBy`;
2. rejects unknown output paths, implicit entity traversal, non-redactable targets, duplicate rules, non-Boolean conditions, and nested disclosure without a rule for every redactable ancestor;
3. records redactable projection members, stable output paths, stable query-scoped rule identities, typed expressions, source expressions, and spans in IR24;
4. treats every redactable projection member as nullable in reusable TypeScript, operation, OpenAPI, HTTP, UI, and semantic contracts whether or not any query currently discloses it;
5. preserves every declared JSON key and emits `null` when its query rule is absent, false, or unknown;
6. evaluates a disclosure condition in the query's existing row, caller, input, and policy scope and grants neither operation authorization nor row visibility;
7. permits only explicit finite nested-projection paths and requires each redactable ancestor to be disclosed independently before a descendant can be non-null;
8. emits static PostgreSQL `CASE WHEN (<condition>) IS TRUE THEN <value> ELSE NULL END` expressions and no dynamic projection or caller-selected field path;
9. publishes the null-redaction mode, fail-closed default, redactable fields, and query rule identities through operation, OpenAPI, HTTP, UI, semantic, enforcement, and provenance artifacts;
10. validates redacted `null` as a legal result and rejects undeclared sentinel strings or omitted required keys at the generated HTTP boundary;
11. includes disclosure rules in paginated query revisions and re-evaluates them on every page;
12. classifies adding a disclosure rule as expansive, removing one as restrictive, changing its Boolean condition by semantic direction where provable and otherwise review, and changing projection redaction eligibility as breaking;
13. accepts IR9 through IR23 as non-redactable, no-rule evolution baselines without fabricating nullable output contracts;
14. emits IR24, operation manifest v10, capability manifest v9, UI manifest v10, semantic manifest/profile v16, semantic diff v17, and generator profile `/19`; and
15. preserves all locked earlier safety, privacy, deterministic generation, filtering, sorting, pagination, evolution, and privilege semantics.
