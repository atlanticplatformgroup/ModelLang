# ModelLang 0.42 bounded agent task packets

## Purpose

A task packet is an authenticated, input-specific, non-authoritative view that places selected action contracts, current action applicability, and selected current-state observations in one bounded result. It is a planning aid, not a command, delegation, prompt, subscription, workflow instance, or authority token.

## Request

The generated HTTP boundary exposes `POST /agent/task-packets`; MCP exposes the same assembler as the read-only `modellang_task_packet` tool. Both accept the same exact JSON Schema 2020-12 input:

- `actions` contains one or more distinct declared action IDs for models with actions, each with its exact closed action input and an optional opaque expected revision;
- `observations` contains zero to 32 declared query calls, each with an opaque caller-chosen binding and the query's exact closed input;
- action IDs are unique and observation bindings are unique; and
- caller identity, command metadata, arbitrary operations, expressions, extensions, and task goals are not inputs.

## Assembly

For every action candidate, the runtime calls the existing authenticated applicability evaluator with the exact validated input and optional revision. For every observation, it calls the existing authenticated query executor and validates the exact output. Consequently, authorization, preconditions, row policies, disclosure, sorting, bounds, pagination, concurrency revisions, and private read evidence retain their existing authoritative behavior.

Assembly does not execute actions and writes no action audit or command receipt. Observation queries retain their declared private transactional read-evidence behavior. Observations are independent reads; the packet does not claim a cross-observation database snapshot.

## Result

Task packet v1 includes:

- exact model, packet, catalog, and resource-envelope identity;
- a random input-hiding packet ID;
- selected static action schemas, failure classes, reliability, emitted event IDs, and workflow transitions;
- a current applicability decision for every selected action;
- selected query results inside unchanged resource envelope v1 values, keyed by the caller's opaque binding;
- point-in-time assembly metadata with `maxAgeSeconds: 0`, `revalidate: "beforeReuse"`, and transport `Cache-Control: no-store`; and
- an explicit partial-closure declaration and named gaps.

The result omits action and observation input values, authenticated identity, expressions, extensions, private evidence, command receipts, and runtime internals. It has `authority: "none"`, grants no capability, and must be reassembled before reuse.

## Partial closure

Packet v1 explicitly reports bounded identity metadata, type closure, evaluated applicability, bounded published effect and lifecycle metadata, caller-selected observations, complete contract versions, and absent recovery metadata. It also declares that full declaration-identity closure is not published, no task goal is modeled, observation relevance is not proven, state-write and external effects are not fully published, and reversibility and recovery are absent.

These limitations are normative. Packet v1 is not complete task closure and does not establish SML-Agent conformance.

## MCP relationship

The MCP adapter returns the exact packet as structured content and as a distinct embedded resource with media type `application/vnd.modellang.agent-task-packet+json`. This ModelLang contract does not implement or advertise MCP Tasks, prompts, resource templates, `resources/read`, subscriptions, elicitation, or sampling.
