# ModelLang 0.31 conformance

An implementation conforms when it satisfies 0.30 conformance and:

1. parses optional `field: NestedProjection` projection members without changing direct-field syntax;
2. requires the selected field to be a to-one entity reference and the nested projection source to match its target;
3. rejects unknown targets, collections, scalar traversal, mismatched targets, and dependency cycles;
4. retains direct entity-reference UUID encoding when no nested projection is named;
5. emits required nested keys with exact object-or-null behavior from reference optionality;
6. treats the finite acyclic authored graph as the full traversal bound and exposes no runtime path selection;
7. constructs allowlisted nested PostgreSQL JSON through declared foreign-key identity without whole-row serialization;
8. publishes only the transitive query-reachable projection closure;
9. emits recursive closed OpenAPI schemas, TypeScript interfaces, HTTP validation, and UI dependency metadata;
10. records transitive projection, entity, member, and source-field read/disclosure closure;
11. classifies direct/nested target changes and changes to transitively reachable projection contracts as breaking;
12. accepts IR19 direct projection members without fabricating traversal;
13. emits IR20, operation manifest v6, capability manifest v5, UI manifest v6, semantic manifest/profile v12, semantic diff v13, and generator profile `/15`; and
14. preserves authenticated row policy, bounded result cardinality, execute-only query access, privacy boundaries, deterministic generation, and all locked earlier semantics.
