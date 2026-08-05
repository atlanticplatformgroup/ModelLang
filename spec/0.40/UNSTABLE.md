# ModelLang 0.40 unstable boundaries

The following remain outside the stable 0.40 contract:

- nonzero cache lifetimes, authored freshness policy, conditional revalidation, ETags, and cache validators;
- database commit timestamps, frozen snapshots, as-of or historical resources, and cross-resource atomicity;
- resource templates, subscriptions, notifications, prompts, and direct MCP protocol integration;
- action results, extension implementations, private evidence, or operational recovery state as agent resources;
- task packets, delegated capabilities, and public decision traces;
- adversarial agent evaluation and SML-Agent conformance.

Future work may add these only through explicit versioned contracts. A resource payload or retrieval timestamp must never be treated as an authority grant or durable freshness proof.
