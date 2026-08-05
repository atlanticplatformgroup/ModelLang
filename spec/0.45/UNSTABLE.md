# ModelLang 0.45 unstable boundaries

The following remain outside the stable 0.45 contract:

- generated, interpreted, deployed, verified, attested, sandboxed, or monitored extension implementations;
- compiler proof of host authorization, service identity, downstream policy, declared effects, idempotency, retry behavior, evidence, tests, availability, or result truth;
- extension implementation discovery, dynamic registration protocols, contract negotiation, backward-compatible revision ranges, caller-selected versions, or historical IR compatibility;
- delegated extension authority, extension task packets, extension resources, resource templates, subscriptions, prompts, MCP Tasks, server notifications, or nonzero reusable lifetime;
- publication of extension locations, owners, test paths, source spans, credentials, service identities, proprietary request metadata, expressions, SQL, or host evidence;
- historical or complete public decision traces, complete task closure, transferable or chained delegation, adversarial agent evaluation, complete SML-Agent conformance, and SML-Federation conformance.

Future work may add these only through explicit versioned contracts. A stable tool binding or successful invocation must never be interpreted as compiler verification, generated implementation, target-gap closure, or authority for a ModelLang action.
