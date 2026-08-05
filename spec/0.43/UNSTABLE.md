# ModelLang 0.43 unstable boundaries

The following remain outside the stable 0.43 contract:

- credential signing/encryption formats, persistent credential-store products, key rotation, distributed atomic-consume implementations, and host deployment topology;
- transferable, multi-use, renewable, refreshable, chained, or re-delegable grants; grant enumeration; offline attenuation; wildcard operations or inputs; and lifetimes beyond one hour;
- consent and approval workflows, task-packet-carried authority, autonomous delegation policy, and public grant or decision traces;
- authored task goals, automatic observation selection, relevance proof, complete effect/recovery closure, multi-step plans, scheduling, retries, and completion tracking;
- public private-evidence observation, command receipts, evidence hashes, and authenticated identity disclosure;
- stateful MCP sessions, MCP Tasks, resource templates, `resources/read`, subscriptions, prompts, elicitation, sampling, and server notifications;
- extension-backed agent tools, adversarial agent evaluation, complete SML-Agent conformance, and SML-Federation conformance.

Future work may add these only through explicit versioned contracts. Discovery, applicability, resources, task packets, authentication alone, or possession of an expired, revoked, consumed, wrong-audience, wrong-delegate, wrong-action, or wrong-input credential must never be interpreted as delegated authority.
