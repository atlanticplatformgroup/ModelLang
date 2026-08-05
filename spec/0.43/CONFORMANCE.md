# ModelLang 0.43 conformance

A conforming implementation:

1. implements the complete ModelLang 0.42 language and conformance requirements;
2. emits deterministic, schema-valid catalog v5, MCP adapter manifest v3, and exact delegated capability v1 issuance, result, and revocation schemas;
3. exposes authenticated HTTP issuance and grantor-bound revocation plus authenticated HTTP and MCP action invocation using a separate opaque credential;
4. accepts only one declared exact action/input, one named delegate, one absolute audience, and a lifetime of at most 3,600 seconds;
5. issues only after the existing grantor-bound applicability evaluator returns `applicable`, and binds the canonical JSON SHA-256 input fingerprint and required concurrency revision;
6. delivers the credential once under no-store/no-cache semantics while omitting input, grantor identity, and delegate identity from the result;
7. requires ordinary authenticated delegate context in addition to the credential and rejects credential use on queries, resources, applicability, subject views, task packets, issuance, and revocation;
8. validates exact action, input hash, model/source/catalog identity, audience, active time window, one-use, non-transfer, no-redelegation, and revision constraints before host dispatch;
9. requires the host credential authority to bind issuance/revocation/delegate identity, securely store and inspect the credential, and atomically recheck, consume, and execute through the stored grantor authority;
10. executes through the existing runtime boundary so current authorization, row and action policy, preconditions, revision, workflow, locks, invariants, effects, evidence, and output validation remain authoritative;
11. treats all catalog and MCP discovery metadata as non-authoritative, keeps actions distinct from resources, and claims neither delegated task packets nor prompts, subscriptions, public traces, extension tools, complete SML-Agent, or SML-Federation conformance; and
12. emits compiler/examples 0.43.0, canonical IR1, delegated capability v1, catalog v5, MCP adapter v3, target profile v7, target `target:postgresql-http-ui-delegated-capabilities/7`, and generator profile `/27`, while retaining task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10.
