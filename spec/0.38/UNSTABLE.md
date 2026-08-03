# ModelLang 0.38 unstable boundaries

The following remain intentionally outside the stable 0.38 contract:

- MCP server transport, lifecycle, discovery, resource, prompt, and authentication integration;
- subject-specific authorization-filtered tool discovery;
- current-state agent resources and freshness lifetimes;
- task packets, delegated capabilities, and public decision traces;
- extension-backed agent tools or external implementation discovery;
- inferred descriptions, effect summaries, destructiveness, reversibility, compensations, or costs;
- adversarial agent evaluation and SML-Agent conformance.

Future work may add these only through explicit versioned contracts. Consumers must not infer them from catalog v1.
