# ModelLang 0.45 conformance

A conforming implementation:

1. implements the complete ModelLang 0.44 language and conformance requirements;
2. emits deterministic, schema-valid catalog v7, MCP adapter manifest v5, and standalone plus model-exact extension tool result v1 schemas;
3. exposes every declared extension through a separate stable catalog binding, authenticated HTTP route, generated client method, and MCP tool with exact input/output schemas;
4. publishes only safe contract metadata and omits implementation location, owner, test paths, source spans, credentials, downstream identity, expressions, SQL, and private evidence;
5. requires a request-bound host adapter to affirm the exact stable extension ID and opaque semantic contract revision, authorize the validated input, and provide the implementation;
6. fails closed for absent or mismatched registration, host denial, malformed input, invalid host output, command metadata, or delegated credentials;
7. returns result envelope v1 with no authority, explicit host-owned implementation/conformance/evidence assertions, no-store transport metadata, and no MCP embedded-resource or current-state freshness claim;
8. uses conservative effect-derived MCP annotations, including open-world behavior whenever the extension may cross a host boundary;
9. keeps core actions, query-backed resources, task packets, delegated capabilities, public traces, and extension tools distinct, and never treats discovery as authority;
10. leaves the extension ledger v1 non-public and non-executable with zero generated implementations and preserves every `externalImplementationRequired` target gap until the host implementation is independently supplied and verified;
11. claims neither generated extension behavior, implementation/test/effect verification, delegated extension authority, extension resources or subscriptions, adversarial agent evaluation, nor complete SML-Agent or SML-Federation conformance; and
12. emits compiler/examples 0.45.0, canonical IR1, catalog v7, MCP adapter v5, extension tool result v1, target profile v9, target `target:postgresql-http-ui-extension-tools/9`, and generator profile `/29`, while retaining public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, extension ledger v1, operation manifest v11, and capability manifest v10.
