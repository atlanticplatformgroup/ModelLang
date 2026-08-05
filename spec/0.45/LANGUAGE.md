# ModelLang 0.45 language

ModelLang 0.45 consists of the complete [ModelLang 0.44 language](../0.44/LANGUAGE.md) plus [extension-backed agent tool adapters](./EXTENSION_TOOLS.md). It adds no source-language grammar and retains canonical IR1.

An existing typed external extension declaration can now produce a public, stable, authenticated tool binding. ModelLang generates exact HTTP and MCP schemas and a host-adapter interface, but it does not generate, deploy, verify, or attest the external implementation. The private extension ledger therefore remains v1, non-executable, and reports zero generated implementations; the target's `externalImplementationRequired` gap remains open.

Version 0.45 advances agent catalog to v7 and MCP adapter manifest to v5, adds extension tool result v1 and target capability `agents.extensionToolAdapter`, and advances target capability profile to v9, target `target:postgresql-http-ui-extension-tools/9`, and generator profile `postgresql-http-ui-extension-tools/29`. Public decision trace v1, delegated capability v1, task packet v1, resource envelope v1, subject capability view v1, operation manifest v11, capability manifest v10, extension ledger v1, and canonical IR1 remain unchanged.
