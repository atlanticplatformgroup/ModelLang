# Contributing to ModelLang

ModelLang is a pre-1.0 reference compiler. Changes must preserve deterministic generation, exact contract schemas, runtime enforcement, and the distinction between discovery metadata and authority.

## Development setup

Requirements:

- Node.js 20 or newer;
- npm 10 or newer; and
- Docker with Compose for live PostgreSQL integration.

```bash
npm ci
npm run model:check
npm run model:generate
npm run db:up
npm run health
```

`npm run health` builds TypeScript, lints, checks dead code, validates agent evaluation fixtures, packs and clean-installs the public npm artifact, and runs all unit and live integration tests. Stop the local database with `npm run db:down`; this deletes its disposable Compose volume.

## Change requirements

- Keep canonical IR at IR2 unless a current semantic requirement genuinely needs a change.
- Advance compiler, generator, target, catalog, schema, and envelope versions independently and only when their contracts change.
- Regenerate both committed examples with `npm run model:generate` and commit all intentional golden changes.
- Add specification, schema, documentation, unit, and live coverage in proportion to the changed contract.
- Do not make discovery, generated metadata, applicability, or cached results grant runtime authority.
- Do not claim host extension behavior, external effects, agent competence, or protocol/profile conformance that is not implemented and tested.
- Run `git diff --check`, `npm run model:check`, `npm run model:generate`, and `npm run health` before proposing the change.

## Pull requests

Keep commits scoped to one coherent milestone or fix. Explain the contract being changed, list every version axis advanced or deliberately retained, and include the exact verification commands and results. Generated artifacts are reviewed outputs, not handwritten source.

By contributing, you agree that your contribution is licensed under the repository's [Apache License 2.0](./LICENSE).
