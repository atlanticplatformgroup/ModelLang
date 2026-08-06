# ModelLang 0.49 unstable boundaries

The following remain outside the stable 0.49 contract:

- ownership or continued availability of an npm name before first publication;
- a particular Git hosting URL, package registry mirror, package-signing service, or support SLA;
- automatic creation of source repositories, npm organizations, trusted-publisher relationships, secrets, tags, releases, or package publication;
- a hosted ModelLang application, managed PostgreSQL, identity provider, public Procurement endpoint, or public Agent Plugin registry entry;
- a stable programmatic JavaScript import API beyond the `modelc` executable and packed compiled modules;
- long-term support for historical pre-1.0 package minors or historical IR formats;
- treating package installation, CI success, npm provenance, Agent Plugin installation, MCP discovery, or a generated manifest as application identity or authority;
- resource templates, subscriptions, prompts, MCP Tasks, complete task closure, full traces, chained delegation, verified extension implementations, complete SML-Agent conformance, or SML-Federation conformance.

Public release metadata may add a real repository or homepage URL after the external source repository exists. Such metadata MUST describe actual external state and MUST NOT be fabricated by the compiler.
