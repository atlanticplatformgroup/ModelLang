# ModelLang 0.47 unstable boundaries

The following remain outside the stable 0.47 contract:

- model-authored or operation-authored cache policy;
- non-private discovery caching, shared-cache publication, CDN configuration, purge APIs, push invalidation, or cache-warming services;
- nonzero freshness for current-state resources, applicability, packets, traces, action results, delegated results, or extension results;
- treating an `ETag`, cached catalog, listed tool, or favorable discovery response as identity, applicability, authority, or current-state evidence;
- MCP resources/list, resource templates, subscriptions, prompts, MCP Tasks, historical/full traces, transferable/chained delegation, generated or verified extension implementations, complete SML-Agent conformance, or SML-Federation conformance.

Future nonzero state freshness requires an explicit semantic contract for acceptable staleness and revalidation. It is not inferred from the deployment-only static discovery TTL.
