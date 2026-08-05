# ModelLang 0.42 conformance

A conforming implementation:

1. implements the complete ModelLang 0.41 language and conformance requirements;
2. emits deterministic, schema-valid catalog v4, MCP adapter manifest v2, and exact task packet v1 input/output schemas;
3. exposes one authenticated HTTP task-packet route and one read-only MCP task-packet assembler with identical exact schemas;
4. accepts only distinct exact action candidates and bounded caller-selected declared query observations, with no caller-supplied identity or command metadata;
5. reuses the existing authenticated applicability evaluator for every action candidate and the existing query executor and output validator for every observation;
6. never executes an action during packet assembly and preserves each query's authorization, row policy, disclosure, sorting, bounds, pagination, validation, and private read-evidence behavior;
7. returns selected static action schemas, safe failure and reliability metadata, emitted event IDs, workflow transitions, current applicability decisions, and unchanged resource envelope v1 observations;
8. omits action and observation input values, authenticated identity, expressions, extensions, private evidence, receipts, and runtime internals from packet results and input-hiding resource URIs;
9. declares `authority: "none"`, explicit partial closure, independent observation reads, point-in-time freshness, zero reusable lifetime, revalidation before reuse, and no-store transport semantics;
10. treats discovery and packet contents as non-authoritative and re-enforces all runtime rules if a later action is invoked;
11. advertises neither MCP Tasks nor resource templates, subscriptions, prompts, delegated capabilities, public decision traces, extension-backed tools, complete task closure, or SML-Agent conformance; and
12. emits compiler/examples 0.42.0, canonical IR1, task packet v1, catalog v4, MCP adapter v2, target profile v6, target `target:postgresql-http-ui-agent-task-packets/6`, and generator profile `/26`, while retaining resource envelope v1, operation manifest v11, and capability manifest v10.
