# ModelLang 0.39 conformance

A conforming implementation:

1. implements the complete ModelLang 0.38 language and conformance requirements;
2. emits deterministic `agent-tools.json` catalog v2 with the unchanged complete static action/query tool set and the exact subject-view binding;
3. authenticates `POST /agent/capabilities` before validating or assessing candidate input;
4. accepts only closed, distinct, declared action candidates and their exact action inputs, bounded to 32; query-only models accept only an empty candidate array;
5. derives every result from the existing authoritative side-effect-free applicability evaluator for the authenticated context and candidate input;
6. returns only exact model metadata and safe available/unavailable overlays with `Cache-Control: no-store`, never identity, candidate input, resource state, expressions, extensions, private evidence, or authority;
7. preserves denied, not-applicable, stale, revision, and safe explanation semantics without converting discovery into execution authority;
8. rejects command metadata headers and does not execute actions, write action audit, or claim an atomic multi-candidate snapshot;
9. leaves queries in the static catalog and exposes no query preflight or current-state resource view;
10. re-enforces all current runtime rules on later action execution, regardless of an earlier view;
11. validates generated catalog and response artifacts against catalog v2 and subject-capability-view v1 schemas;
12. emits compiler/examples 0.39.0, canonical IR1, target profile v3, target `target:postgresql-http-ui-agent-subject-view/3`, and generator profile `/23`, while retaining operation manifest v11 and capability manifest v10.
