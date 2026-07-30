# ModelLang 0.9 unstable workflow boundaries

The following remain undefined:

- nested, parallel, hierarchical, or orthogonal state machines;
- multiple workflows targeting the same field;
- workflows spanning multiple entities or fields;
- transition events without actions;
- wildcard sources, guards declared inside workflows, and computed destinations;
- automatic authorization, assignment, snapshot, notification, or compensation behavior;
- timed, scheduled, asynchronous, reversible, or externally triggered transitions;
- entry actions, exit actions, hooks, and transition return values;
- automatic history tables or event-sourced workflow persistence;
- proving action identity inside an elevated direct SQL statement;
- partial workflows whose enum contains intentionally unreachable members;
- automatic migration of workflow targets, names, states, edges, triggers, or action bindings;
- frontend form, page, or routing generation from workflow metadata.
