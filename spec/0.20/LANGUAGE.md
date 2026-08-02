# ModelLang 0.20 — Normative Language

Status: normative specification for the 0.20 reference compiler.

ModelLang 0.20 consists of the complete [ModelLang 0.19 language](../0.19/LANGUAGE.md) plus stable typed domain-event declarations, action emission clauses, and the [transactional event contract](./EVENTS.md).

An event is declared as `event Name @stableId("evt_...") payload Entity;`. An action may append one or more `emit Name;` clauses after its create or update effect. Each named event may occur at most once in an action, and its payload entity must equal the action's return and effect entity. The emitted payload is the complete post-effect entity value returned by that action.

Version 0.20 advances canonical IR to IR12, operation manifest to v4, capability manifest to v3, UI manifest to v4, engineering semantic manifest to v4, and semantic diff to v5. It introduces event manifest v1. Decision plan v2 and HTTP operation routes remain unchanged.

All locked identity, value, authorization, applicability, policy, evidence, workflow, reliable-command, migration, privilege, and fail-closed semantics from earlier versions remain normative. Where 0.20 differs, this version takes precedence.
