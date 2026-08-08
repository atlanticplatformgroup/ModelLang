# ModelLang 0.50 language

ModelLang 0.50 consists of the complete [ModelLang 0.49 language](../0.49/LANGUAGE.md) plus [atomic multi-entity action effects](./ATOMIC_EFFECTS.md).

The release advances the compiler and npm package to 0.50.0, canonical IR to IR2, the engineering semantic manifest to v19/profile `sml-transactional-core/19`, semantic diff to v20, and the generator profile to `postgresql-http-ui-agent-plugin-atomic-effects/33`.

The source change is backward compatible for existing single-effect models. The canonical IR change is intentionally breaking: evolution commands accept only exact current IR2 inputs and do not silently normalize historical IR1 artifacts. Operation manifest v11, capability manifest v10, MCP adapter v6, catalog v7, target profile v9 and target `target:postgresql-http-ui-extension-tools/9`, Agent Plugins 1.0.0, public runtime envelopes, and generated HTTP/MCP operation shapes remain unchanged.
