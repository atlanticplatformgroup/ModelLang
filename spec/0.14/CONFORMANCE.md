# ModelLang 0.14 workflow-application conformance

The 0.14 implementation is conformant when:

1. All 0.13 language, UI, transport, identity, enforcement, migration, and golden-artifact tests continue to pass.
2. Source grammar, canonical IR9, stable HTTP routes and JSON operation shapes, PostgreSQL output, and migration behavior remain unchanged.
3. Operation manifest v2 deterministically includes each entity's canonical identity field and every canonical workflow, transition, source/destination member, bound action, and callable target parameter by semantic ID.
4. Operation manifest v2 conforms to `schemas/operation-manifest.schema.json` and remains free of HTTP routes, SQL, PostgreSQL types, database roles, and UI concepts.
5. Workflow target bindings always identify ordinary operation input and never authenticated caller context.
6. UI manifest v2 conforms to `schemas/ui-manifest.schema.json`, records operation manifest version 2, and is derived exclusively from that manifest.
7. UI workflows preserve stable identities, generated labels, state values, initial and terminal classification, edges, action bindings, and target bindings.
8. Transition fields exclude the bound entity target while preserving every other callable action field in order.
9. State-based availability returns only source-matching edges and makes no authorization or precondition claim.
10. Unknown workflow and transition IDs fail closed as typed validation before network or database access.
11. Typed transition execution maps neutral `targetId` to the manifest-declared callable parameter, forwards all other input through the generated HTTP client, and never accepts caller identity.
12. The browser entry point remains free of Node.js, SQL, PostgreSQL, and server gateway contracts.
13. Models without workflows emit valid empty workflow arrays and compilable browser artifacts.
14. Live Procurement integration selects transitions from returned entity state, executes them through authenticated HTTP and the shared gateway, and preserves authorization, precondition, workflow, audit, and caller-binding behavior.
