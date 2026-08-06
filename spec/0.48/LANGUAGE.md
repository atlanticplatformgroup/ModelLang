# ModelLang 0.48 language

ModelLang 0.48 consists of the complete [ModelLang 0.47 language](../0.47/LANGUAGE.md) plus [optional Agent Plugin packaging](./AGENT_PLUGIN_PACKAGING.md). It adds no source-language grammar, canonical IR field, authority surface, domain operation, MCP wire behavior, or freshness option and retains canonical IR1.

A build may receive a deployment-time Agent Plugin configuration containing an MCP endpoint URL and optional package name. When present, the generator emits an isolated `agent-plugin/` package root conforming to the pinned Agent Plugins 1.0.0 Working Draft schemas. When absent, the compiler emits no package and retains deterministic IR-only application generation.

The package contains only portable identity metadata and one Streamable HTTP MCP connection. It contains no credentials or authorization headers. Agent Plugin discovery and installation grant no authority; the generated application's existing per-request authentication and runtime policy enforcement remain authoritative.

Version 0.48 advances compiler and examples to 0.48.0 and generator profile to `postgresql-http-ui-agent-plugin/32`. Canonical IR1, MCP adapter v6, catalog v7, target profile v9 and target `target:postgresql-http-ui-extension-tools/9`, SML-Agent assessment v1, evaluation suite/replay v1, extension tool result v1, extension ledger v1, public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.
