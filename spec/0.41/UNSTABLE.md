# ModelLang 0.41 unstable boundaries

The following remain outside the stable 0.41 contract:

- stateful MCP sessions, server notifications, dynamic tool-list changes, resource templates, `resources/read`, subscriptions, and prompts;
- MCP tasks, elicitation, sampling, or other agent orchestration contracts;
- host OAuth authorization-server implementation, token issuance, client registration, consent, credential storage, and deployment policy;
- nonzero cache lifetimes, authored freshness policy, ETags, validators, database commit timestamps, frozen snapshots, as-of resources, and cross-resource atomicity;
- task packets, delegated capabilities, public decision traces, public/private evidence observation, and extension-backed agent tools;
- adversarial agent evaluation, complete SML-Agent conformance, and SML-Federation conformance.

Future work may add these only through explicit versioned contracts. Tool discovery, an embedded resource, protocol authentication, or execution metadata must never be interpreted as delegated authority.
