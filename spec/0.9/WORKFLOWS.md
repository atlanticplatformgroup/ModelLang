# ModelLang 0.9 — Workflows

Status: normative design contract for the 0.9 reference compiler.

## Declaration

A workflow makes the legal lifecycle of one stored enum field explicit:

```modellang
workflow PurchaseRequestLifecycle @stableId("wfl_11111111111111111111111111111111")
  for PurchaseRequest.status {
  initial RequestStatus.DRAFT;
  transition submit @stableId("trn_11111111111111111111111111111111"):
    RequestStatus.DRAFT -> RequestStatus.SUBMITTED by submitRequest;
  transition approve @stableId("trn_22222222222222222222222222222222"):
    RequestStatus.SUBMITTED -> RequestStatus.APPROVED by approveRequest;
}
```

The target must be one required, stored enum field. At most one workflow may target a field. The field must declare a constant default equal to the workflow's `initial` member.

Workflow and transition names are unique within their scopes. Durable workflows and transitions use `wfl_...` and `trn_...` stable IDs. `modelc assign-ids` assigns both kinds.

## Transition/action contract

Every transition names one existing action. That action must:

1. update the workflow's entity;
2. assign the workflow field exactly to the transition destination;
3. contain a named `require` whose complete expression compares the update target's workflow field to the transition source.

For example, `DRAFT -> SUBMITTED by submitRequest` requires both:

```modellang
require is_draft: request.status == RequestStatus.DRAFT;
update request { status = RequestStatus.SUBMITTED; }
```

An action may implement at most one edge in a workflow. Duplicate edges and self-transitions are invalid. Any update action that assigns a workflow field must be named by a transition. Any create action for the entity must leave the field at the initial state, either by assigning it explicitly or by using its required initial default.

The workflow does not supply authorization, preconditions, assignments, or audit data. Those remain explicit in the action. In particular, declaring an edge never grants a caller permission to traverse it.

Every enum member used by the workflow field must be reachable from the initial state through declared edges. Terminal states are states with no outgoing edge.

## Canonical IR

Canonical IR version 9 adds `workflows`. Each workflow records stable identity, entity, field, enum, initial member, transitions, and generated names. Each transition records stable identity, source and destination member IDs, and its action ID. Generators consume these IDs rather than resolving source names again.

## Generated enforcement

PostgreSQL receives two triggers per workflow:

- an `AFTER INSERT` trigger requiring the initial state;
- a `BEFORE UPDATE OF <field>` trigger allowing only declared source/destination pairs.

Failures use SQLSTATE `23514`, an `ML_WORKFLOW:<workflow-id>` message, and the generated trigger name as the constraint. Generated TypeScript maps these failures to `TransitionError`.

The database trigger enforces state shape, not business authority. Generated action functions still enforce the transition action's caller identity, authorization, named source-state requirement, locking, assignments, and auditing. Application roles cannot write tables directly. An elevated database authority outside the runtime trust boundary can execute a legal edge directly; the trigger cannot prove which action caused a statement.

TypeScript receives read-only workflow metadata containing the initial state and each transition's name, source, destination, and action. Mermaid output includes lifecycle edges. Both are generated from IR9.

## Migration behavior

The 0.9 rename planner requires explicit workflow and transition stable IDs. Additions, removals, workflow renames, edge changes, action rebinding, target changes, and generated workflow physical-name changes—including a target entity or field rename—fail closed for manual review. The compiler does not silently recreate or rename workflow triggers during a rename-only plan.
