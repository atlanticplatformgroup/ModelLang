# ModelLang 0.39 unstable boundaries

The following remain intentionally outside the stable 0.39 contract:

- MCP server transport, lifecycle, discovery, resource, prompt, and authentication integration;
- current-state agent resources, resource templates, and freshness lifetimes;
- subject-filtered query discovery or query preflight;
- task packets, delegated capabilities, and public decision traces;
- extension-backed agent tools or external implementation discovery;
- inferred descriptions, effect summaries, destructiveness, reversibility, compensations, or costs;
- atomic multi-action planning snapshots;
- adversarial agent evaluation and SML-Agent conformance.

Future work may add these only through explicit versioned contracts. Consumers must not treat a subject capability view, its revision, or its omission of an action as an authority grant or permanent fact.
