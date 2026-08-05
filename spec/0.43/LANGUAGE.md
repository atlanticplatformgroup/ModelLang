# ModelLang 0.43 language

ModelLang 0.43 consists of the complete [ModelLang 0.42 language](../0.42/LANGUAGE.md) plus [bounded delegated capabilities](./DELEGATED_CAPABILITIES.md). It adds no source-language grammar and retains canonical IR1.

An authenticated grantor may delegate one currently applicable declared action with one exact validated input to one named authenticated delegate and one audience for at most one hour and one successful invocation. The grant is bound to the current concurrency revision, is non-transferable, cannot be re-delegated, and remains subject to the action's authoritative runtime authorization, preconditions, invariants, workflow, locking, and output validation.

Version 0.43 advances agent catalog to v5 and MCP adapter manifest to v3, and adds delegated capability v1 plus target capability `agents.delegatedCapabilities`. It advances target capability profile to v7, target `target:postgresql-http-ui-delegated-capabilities/7`, and generator profile `postgresql-http-ui-delegated-capabilities/27`; task packet v1, resource envelope v1, subject capability view v1, operation manifest v11, capability manifest v10, and canonical IR1 remain unchanged.
