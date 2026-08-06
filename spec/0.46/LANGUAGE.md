# ModelLang 0.46 language

ModelLang 0.46 consists of the complete [ModelLang 0.45 language](../0.45/LANGUAGE.md) plus [adversarial agent assurance](./AGENT_ASSURANCE.md) and a [non-empirical agent evaluation contract](./AGENT_EVALUATION.md). It adds no source-language grammar, authority surface, or runtime operation and retains canonical IR1.

The release generates SML-Agent assessment v1 as a conservative engineering-assurance artifact. It maps each whitepaper SML-Agent criterion to supported, partial, or absent status, cites existing evidence, names gaps, reports only overall partial alignment, and explicitly attests neither test execution nor agent competence.

Agent evaluation suite and replay formats v1 define four comparison conditions, fixed tasks, provider-neutral observations, and deterministic scoring. The committed replay is a synthetic scorer fixture and makes no empirical claim. Live language-model runs remain optional and outside release conformance.

Version 0.46 advances compiler and examples to 0.46.0 and generator profile to `postgresql-http-ui-agent-assurance/30`. SML-Agent assessment, agent evaluation suite, and agent evaluation replay are v1. Canonical IR1, catalog v7, MCP adapter v5, target profile v9 and target `target:postgresql-http-ui-extension-tools/9`, extension tool result v1, extension ledger v1, public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, operation manifest v11, and capability manifest v10 remain unchanged.
