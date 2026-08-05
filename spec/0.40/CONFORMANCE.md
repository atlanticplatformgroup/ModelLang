# ModelLang 0.40 conformance

A conforming implementation:

1. implements the complete ModelLang 0.39 language and conformance requirements;
2. emits deterministic agent catalog v3 with one exact agent-resource binding per declared query and none for actions;
3. authenticates every resource request and accepts only the query's exact closed callable input without caller identity or command metadata;
4. executes the existing authoritative query path and preserves authorization, row policy, projection disclosure, sorting, bounds, pagination, output validation, and opted-in private read evidence;
5. emits resource envelope v1 with exact model/query identity, `authority: "none"`, and only the validated query result as current-state data;
6. omits request input, authenticated identity, extensions, expressions, runtime internals, and private evidence from the envelope;
7. returns `Cache-Control: no-store` and freshness `{ mode: "pointInTime", maxAgeSeconds: 0, revalidate: "beforeReuse" }` with a valid retrieval timestamp;
8. makes no cache lifetime, database commit-time, atomic multi-resource snapshot, as-of, or action-authority claim;
9. re-enforces current state and authority on every later action regardless of resource contents;
10. validates catalog and resource envelopes against catalog v3 and resource-envelope v1 schemas;
11. emits compiler/examples 0.40.0, canonical IR1, target profile v4, target `target:postgresql-http-ui-agent-resources/4`, and generator profile `/24`, while retaining operation manifest v11 and capability manifest v10.
