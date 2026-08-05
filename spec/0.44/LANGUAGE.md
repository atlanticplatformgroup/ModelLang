# ModelLang 0.44 language

ModelLang 0.44 consists of the complete [ModelLang 0.43 language](../0.43/LANGUAGE.md) plus [bounded public decision traces](./PUBLIC_DECISION_TRACES.md). It adds no source-language grammar and retains canonical IR1.

The new trace contract is an authenticated, input-specific read of current action applicability. It publishes ordered safe rule outcomes and the existing non-authoritative applicability decision, but no input, state value, authenticated identity, expression, policy or authority identity, or private execution evidence. It is neither a historical trace nor evidence that an action executed.

Version 0.44 advances agent catalog to v6 and MCP adapter manifest to v4, and adds public decision trace v1 plus target capability `agents.publicDecisionTraces`. It advances target capability profile to v8, target `target:postgresql-http-ui-public-decision-traces/8`, and generator profile `postgresql-http-ui-public-decision-traces/28`; delegated capability v1, task packet v1, resource envelope v1, subject capability view v1, operation manifest v11, capability manifest v10, and canonical IR1 remain unchanged.

