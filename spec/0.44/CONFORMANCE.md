# ModelLang 0.44 conformance

A conforming implementation:

1. implements the complete ModelLang 0.43 language and conformance requirements;
2. emits deterministic, schema-valid catalog v6, MCP adapter manifest v4, and standalone plus model-exact public decision trace v1 schemas;
3. exposes authenticated HTTP and MCP trace operations for exactly one declared schema-valid action candidate with optional opaque revision;
4. derives every trace from the existing authoritative current applicability evaluator without executing the action or writing successful-execution evidence;
5. publishes authorization, ordered requirement, and revision outcomes with the exact short-circuit semantics in [PUBLIC_DECISION_TRACES.md](./PUBLIC_DECISION_TRACES.md);
6. preserves the existing safe applicability decision while publishing no supplied input, current state value, authenticated identity, expression, policy identity, authority identity, or private evidence;
7. marks scope as applicability, current evaluation as true, execution observed and durable evidence as false, and complete decision trace as false;
8. uses point-in-time transport time, zero reusable lifetime, revalidation before reuse, and no-store HTTP and MCP metadata;
9. rejects caller command metadata and delegated capability credentials on trace operations;
10. treats catalog and MCP discovery and every trace as non-authoritative, keeps actions, resources, packets, delegations, and traces distinct, and re-enforces all current rules on later execution;
11. claims neither historical or complete public decision traces, public private-evidence observation, prompts, subscriptions, MCP Tasks, extension-backed tools, adversarial evaluation, nor complete SML-Agent or SML-Federation conformance; and
12. emits compiler/examples 0.44.0, canonical IR1, public decision trace v1, catalog v6, MCP adapter v4, target profile v8, target `target:postgresql-http-ui-public-decision-traces/8`, and generator profile `/28`, while retaining delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10.

