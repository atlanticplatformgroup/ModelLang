# ModelLang 0.40 language

ModelLang 0.40 consists of the complete [ModelLang 0.39 language](../0.39/LANGUAGE.md) plus [authenticated current-state agent resources](./AGENT_RESOURCES.md). It adds no source-language grammar.

Every declared query gains a separate agent-resource binding in static agent catalog v3. The binding executes the existing authenticated query contract and wraps its exact result in resource envelope v1 with conservative point-in-time freshness metadata. Actions remain tools rather than resources.

Version 0.40 retains canonical IR1, operation manifest v11, capability manifest v10, and subject capability view v1. It advances target capability profile to v4, target `target:postgresql-http-ui-agent-resources/4`, and generator profile `postgresql-http-ui-agent-resources/24`.
