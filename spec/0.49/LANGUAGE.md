# ModelLang 0.49 language

ModelLang 0.49 consists of the complete [ModelLang 0.48 language](../0.48/LANGUAGE.md) plus the [public preview distribution contract](./PUBLIC_PREVIEW_DISTRIBUTION.md). It adds no source-language grammar, canonical IR field, authority surface, generated application contract, MCP behavior, or freshness option and retains canonical IR1.

The compiler is distributed as the public Apache-2.0 npm package `modellang`, whose `modelc` executable supports the existing check, build, IR, explanation, stable-ID, migration, reviewed-migration, and semantic-diff commands. The packed artifact includes compiled compiler modules and every schema required at runtime while excluding repository-only tests, scripts, goldens, examples, plans, and specifications.

Version 0.49 advances compiler, npm package, and examples to 0.49.0. Canonical IR1, generator profile `postgresql-http-ui-agent-plugin/32`, MCP adapter v6, catalog v7, target profile v9 and target `target:postgresql-http-ui-extension-tools/9`, Agent Plugins 1.0.0 package format, SML-Agent assessment v1, evaluation suite/replay v1, and every existing runtime envelope version remain unchanged.
