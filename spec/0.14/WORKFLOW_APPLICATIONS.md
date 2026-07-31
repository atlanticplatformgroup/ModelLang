# ModelLang 0.14 — Workflow application boundaries

Status: normative design contract for the 0.14 reference compiler.

## Purpose and boundary

ModelLang 0.14 exposes the workflows already proven by canonical IR9 and PostgreSQL through the transport-neutral and framework-neutral application contracts. A frontend can identify the lifecycle governing an entity, render its states and structurally matching transition controls, collect any additional declared action input, and execute the action through authenticated HTTP.

This release does not create a capability oracle. A state-matching edge may still fail action authorization, a named precondition, a concurrent-state check, an invariant, or another declared operation rule. Generated helpers never predict those results; PostgreSQL and the authenticated action remain authoritative.

## Operation manifest version 2

Operation manifest v2 retains all v1 model, authentication, enum, operation, input, output, error, and caller semantics. Each entity additionally records its canonical stable `idFieldId`, allowing a consumer to obtain entity identity without assuming a source property name. It also adds a required top-level `workflows` array. A model without workflows emits an empty array.

Each workflow records:

- its durable workflow ID and current name;
- the stable entity, state-field, and enum IDs;
- the stable initial enum-member ID; and
- its ordered transitions.

Each transition records its durable transition ID, current name, stable source and destination enum-member IDs, stable action operation ID, and target binding.

The target binding has `source: "operationInput"`, the action parameter identifier, and its current input name. ModelLang update actions cannot target the authenticated caller, and a conforming workflow transition action updates one callable entity parameter. Therefore workflow metadata never turns caller context into request data.

Operation manifest v2 remains transport-neutral. It contains no HTTP route, SQL name, PostgreSQL type, role, connection, or UI component.

Consumers supporting only operation manifest v1 must reject v2 rather than ignoring workflow semantics. The generated HTTP routes and JSON operation shapes do not change; OpenAPI records the new manifest provenance in descriptive metadata only.

## UI manifest version 2

UI manifest v2 retains all v1 authentication, label, enum, entity, action-form, query-filter/table, presentation, and error semantics. Entity descriptors preserve `idFieldId`, so a generic renderer can resolve the returned object's identity property through the matching field descriptor. It records `operationManifestVersion: 2` and adds a required `workflows` array derived only from operation manifest v2.

A UI workflow contains:

- its stable workflow, entity, state-field, enum, and initial-member IDs;
- its current name and generated default label;
- all enum states with stored value, generated label, and `initial` and `terminal` flags; and
- all transitions with stable IDs, stored source/destination values, action operation ID, target binding, and additional form fields.

A state is terminal exactly when the workflow declares no outgoing transition from that member. This is structural lifecycle metadata, not a guarantee that no other declared action can update non-workflow fields.

The transition `fields` array is the bound action's callable input with its workflow target parameter removed. A renderer binds the entity currently being displayed rather than asking the user to select the same target again. Any other action parameters remain required, typed fields with the same semantics as ordinary action forms.

## Structural availability

`available<Model>UiTransitions(workflowId, state)` and the workflow executor's `available` method return transitions whose declared source value equals the supplied current state value. Unknown workflow IDs fail closed as typed `ValidationError` with code `ML_UI_WORKFLOW_NOT_FOUND` and rule ID `ui:workflow`. A known state with no outgoing edge returns an empty list.

Structural availability means only that the current value matches the declared edge. It does not evaluate caller authorization, named preconditions, current database state, relationship data, money thresholds, concurrency, or invariants. Applications must handle typed failures returned by execution and refresh stale entity data when appropriate.

## Typed transition execution

`create<Model>UiWorkflowExecutor` accepts only the generated browser HTTP client. Its `executeTransition` method is indexed by stable transition ID and accepts the displayed entity's identity as a separate `targetId` argument. For a transition action whose target input is named, for example, `request`, the generated transition input omits that field and retains every other callable field:

```ts
type SubmitTransitionInput =
  Omit<SubmitRequestInput, "request">;
```

At execution, the helper writes the separate `targetId` argument into the manifest-declared target parameter after all remaining input, so request data cannot override the binding, and invokes the existing typed HTTP-client action. Keeping the target separate also avoids collisions with ModelLang parameter names. `targetId` represents ordinary callable entity input; it is never authenticated caller identity. Caller identity continues to come exclusively from authenticated server context.

Unknown transition IDs fail before network access as typed `ValidationError` with code `ML_UI_TRANSITION_NOT_FOUND` and rule ID `ui:transition`.

The helper supplies no alternate mutation path. Exact HTTP input/output validation, typed transport errors, server identity binding, action authorization, locking, workflow triggers, invariants, auditing, and PostgreSQL enforcement remain unchanged.

## Stable identity and renames

Workflow, transition, action, entity, field, enum, and enum-member references use durable semantic IDs. Renaming one of those declarations changes generated names or labels but not the corresponding workflow binding. As in 0.13, callable parameter identifiers are operation-shape identifiers rather than durable declaration IDs; changing a target parameter name changes the public operation shape and regenerated target binding.

## Deliberate scope

Version 0.14 does not provide authorization-based visibility, preflight permission checks, disabled-state explanations, server capability discovery, speculative guard evaluation, automatic refresh, optimistic concurrency, confirmation policy, undo, compensation, history timelines, workflow diagrams as UI components, or framework-specific buttons.

Parallel and hierarchical states, wildcard transitions, cross-entity workflows, timers, asynchronous events, entry/exit hooks, and other workflow forms remain outside the underlying ModelLang workflow language.
