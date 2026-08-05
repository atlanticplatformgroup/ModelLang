# ModelLang 0.44 unstable boundaries

The following remain outside the stable 0.44 contract:

- historical, persisted, signed, externally attested, cross-service, or complete public decision traces;
- publication of evaluated/current state values, request inputs, authenticated identities, expressions, policy or authority-branch identities, SQL, private successful-execution evidence, read evidence, receipts, event/consumer evidence, or failure/recovery evidence;
- trace correlation with an execution, audit lookup, trace enumeration, public trace storage, nonzero trace lifetime, as-of evaluation, frozen snapshots, subscriptions, or notifications;
- authored task goals, automatic observation selection, relevance proof, complete effect/recovery closure, plans, scheduling, retries, and completion tracking;
- stateful MCP sessions, resource templates, `resources/read`, subscriptions, prompts, elicitation, sampling, MCP Tasks, and server notifications;
- extension-backed agent tools, adversarial agent evaluation, complete SML-Agent conformance, and SML-Federation conformance;
- broader delegated authority including transferable, multi-use, renewable, chained, wildcard, or re-delegable grants.

Future work may add these only through explicit versioned contracts. Discovery, applicability, resources, task packets, public traces, authentication, or private evidence references must never be interpreted as action or delegated authority.

