# ModelLang 0.38 language

ModelLang 0.38 consists of the complete [ModelLang 0.37 language](../0.37/LANGUAGE.md) plus the generated [static agent tool catalog](./AGENT_TOOL_CATALOG.md). It adds no source-language grammar.

Every successful build emits `agent-tools.json` from the already derived operation and filtered capability contracts. The artifact exposes only declared action/query tools and never expands the model's callable surface or authority.

Version 0.38 resets the pre-release canonical format to IR1 and accepts only that exact format for evolution input. Migrations between two IR1 artifacts remain supported. It introduces agent tool catalog v1, advances target capability profile to v2 and `target:postgresql-http-ui-agent-catalog/2`, and advances the generator profile to `postgresql-http-ui-agent-tool-catalog/22`. Private PostgreSQL runtime profile 36 remains unchanged.
