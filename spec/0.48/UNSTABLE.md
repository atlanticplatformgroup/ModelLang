# ModelLang 0.48 unstable boundaries

The following remain outside the stable 0.48 contract:

- Agent Plugins package registries, archives, signing, publication, installation, enablement, updates, or compatible-client certification;
- portable OAuth, credential references, secret headers, interactive authentication setup, or client-specific credential storage;
- generated stdio launchers, legacy SSE configuration, transport fallback, Agent Skills, or client-specific extension namespaces;
- putting deployment URLs or package metadata into ModelLang source or canonical IR;
- treating plugin installation, MCP discovery, an `ETag`, a listed tool, or a connection as identity, applicability, authority, or execution evidence;
- changing the ModelLang adapter manifest into the Agent Plugins connection document;
- MCP resources/list, resource templates, subscriptions, prompts, MCP Tasks, historical/full traces, transferable/chained delegation, generated or verified extension implementations, complete SML-Agent conformance, or SML-Federation conformance.

Agent Plugins 1.0.0 is pinned as a Working Draft external contract. A later incompatible package-format revision requires an explicit generator contract change; it does not silently reinterpret already generated packages.
