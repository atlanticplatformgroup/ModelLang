# ModelLang 0.39 language

ModelLang 0.39 consists of the complete [ModelLang 0.38 language](../0.38/LANGUAGE.md) plus [authenticated subject capability views](./SUBJECT_CAPABILITY_VIEWS.md). It adds no source-language grammar.

Every successful build still emits the static `agent-tools.json`, now catalog v2, and the catalog-declared `POST /agent/capabilities` contract. Models with actions use it for authenticated, subject-specific, exact-input action filtering; query-only models accept only an empty candidate set. Query tools remain static-catalog-only in 0.39. The view contains neither caller identity nor resource state and never grants authority.

Version 0.39 retains canonical IR1 and the strict current-format evolution baseline. It advances target capability profile to v3, target `target:postgresql-http-ui-agent-subject-view/3`, and generator profile `postgresql-http-ui-agent-subject-view/23`. Operation manifest v11, capability manifest v10, and the source language remain unchanged.
