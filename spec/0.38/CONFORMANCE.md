# ModelLang 0.38 conformance

A conforming implementation:

1. implements the complete ModelLang 0.37 language and conformance requirements;
2. emits one deterministic `agent-tools.json` catalog v1 for every successful build;
3. derives tools only from the operation manifest and filtered capability manifest;
4. emits exactly one tool per declared action and query, with stable identity and existing authenticated HTTP routes;
5. emits standalone JSON Schema 2020-12 input/output documents with closed modeled objects and no authenticated-caller input;
6. exposes action applicability outcomes and safe rule IDs without expressions or authority grants;
7. preserves action reliability, event declarations, errors, and query bounds/read metadata exactly;
8. excludes extensions, implementation locations, current state, private runtime state, and enforcement expressions;
9. re-enforces authentication, authorization, preconditions, and state rules at runtime regardless of catalog or applicability results;
10. does not claim direct MCP protocol or SML-Agent conformance from this artifact;
11. emits compiler 0.38.0, agent catalog v1, target profile v2, target `target:postgresql-http-ui-agent-catalog/2`, and generator profile `/22`, while retaining IR26 and private runtime profile 36.
