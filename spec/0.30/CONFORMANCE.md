# ModelLang 0.30 conformance

An implementation conforms when it satisfies 0.29 conformance and:

1. parses named projection declarations and mandatory query `returns Projection` clauses;
2. enforces `prj_` and `pfd_` stable identity, uniqueness, and deterministic ID assignment;
3. requires at least one unique direct source field and rejects unknown or collection-valued selections;
4. rejects projection use anywhere except query results;
5. requires query and projection source entities to match;
6. preserves selected scalar, enum, exact-money, reference, generated-value, nullable, and snapshot encodings;
7. emits every selected key and encodes optional stored null as JSON `null`;
8. permits hidden predicate and ordering fields without disclosing them;
9. constructs allowlisted PostgreSQL JSON directly and never performs whole-row serialization followed by redaction;
10. emits IR19 projections and query `returnProjectionId` references conforming to the canonical schema;
11. emits operation manifest v5, capability manifest v4, UI manifest v5, semantic manifest/profile v11, semantic diff v12, and generator profile `/14` while retaining the other locked versions named by `LANGUAGE.md`;
12. derives closed OpenAPI schemas, HTTP output validation, TypeScript projection arrays, and UI query results from one reachable-projection manifest contract;
13. separates source read sets from disclosure sets in engineering and enforcement artifacts;
14. compares projection and member evolution by stable identity and classifies reachable output changes as breaking; and
15. accepts released IR9–IR18 evolution inputs as historical entity results without fabricating projection identity or allowing automatic-safe narrowing.
