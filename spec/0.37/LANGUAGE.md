# ModelLang 0.37 language

ModelLang 0.37 consists of the complete [ModelLang 0.36 language](../0.36/LANGUAGE.md) plus [target capability profiles and the extension ledger](./TARGET_CAPABILITIES_AND_EXTENSIONS.md).

An `extension` is a typed, stable, engineering-only declaration of behavior implemented outside the ModelLang core. It records ownership, implementation location, declared reads, writes, external systems, emitted events, reliability, authorization context, test obligations, rationale, and a promotion criterion. It is not callable from an action, query, consumer, HTTP route, capability manifest, generated client, or PostgreSQL function.

Every build emits `extensions.json` and `target-capabilities.json`. The canonical `target:postgresql-http-ui/1` profile reports native support for current core semantics and identifies every extension as an external implementation gap. A gap is not a compiler error because the declaration explicitly places that behavior outside generated authority; it is never reported as native conformance.

Version 0.37 advances canonical IR to IR26, engineering semantic manifest/profile to v18, semantic diff to v19, artifact provenance to v2, and generator profile to `postgresql-http-ui-target-capabilities/21`. It introduces target capability profile v1 and extension ledger v1. Operation manifest v11, capability manifest v10, UI manifest v11, decision plan v2, event manifest v5, event envelope v2, stable HTTP routes, and private PostgreSQL runtime profile 36 remain unchanged.
