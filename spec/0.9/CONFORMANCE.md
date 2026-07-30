# ModelLang 0.9 workflow conformance

The 0.9 implementation is conformant when:

1. All 0.8 conformance tests continue to pass.
2. Workflow and transition declarations parse with optional stable IDs.
3. `modelc assign-ids` assigns `wfl_...` and `trn_...` identities idempotently.
4. Canonical IR version 9 resolves workflow targets, enum members, and transition actions by semantic ID.
5. Workflow targets are required enum fields whose defaults equal their initial states.
6. Transition actions update the target entity, guard the source state with a named requirement, and assign the destination state.
7. Undeclared state writes, duplicate edges, self-transitions, duplicate action bindings, and unreachable states fail compilation.
8. Create actions cannot initialize a workflow entity outside its initial state.
9. PostgreSQL rejects non-initial inserts and undeclared update edges with named `ML_WORKFLOW` failures.
10. Legal generated action transitions continue to satisfy authorization, precondition, locking, invariant, and audit behavior.
11. Generated TypeScript exports workflow metadata and maps workflow database failures to `TransitionError`.
12. Mermaid and enforcement artifacts expose the initial-state and transition contracts.
13. Workflow-aware rename planning requires complete stable IDs and fails closed on workflow changes.
14. Unit and live PostgreSQL tests exercise legal edges, invalid compiler contracts, invalid direct inserts, and skipped-state direct updates.
