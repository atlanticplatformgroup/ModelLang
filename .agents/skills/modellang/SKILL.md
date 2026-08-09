---
name: modellang
description: Install, configure, model, compile, explain, evolve, and troubleshoot applications with ModelLang and the modelc CLI. Use for .model files, semantic application models, generated PostgreSQL/TypeScript/OpenAPI/MCP boundaries, ModelLang compiler errors, or requests to add ModelLang to a Node.js project. Do not use for unrelated ORM or database-schema work unless the user specifically wants ModelLang.
---

# ModelLang

Help users turn application rules into a checked ModelLang model and generated enforcement boundary. Base commands and syntax on the installed compiler or the repository documentation; never guess unsupported language features.

## Start by inspecting

1. Identify the repository root, package manager, Node.js version, existing `*.model` files, and whether `modellang` is already installed.
2. Run `node "${SKILL_DIR}/scripts/doctor.mjs"` from the target project when `SKILL_DIR` is available. Otherwise run the script using its resolved path.
3. Determine the environment:
   - In the ModelLang source repository, use `npm ci`, `npm run build`, and `node dist/src/cli.js`.
   - In another project with ModelLang installed, use the local `modelc` through `npx --no-install modelc` or the project's package-manager equivalent.
   - In another project without ModelLang, follow **Install ModelLang**.
4. Read `references/quickstart.md` before creating the first model. Read `references/troubleshooting.md` only for errors, installation failures, or unexpected output.

Preserve the user's package manager and existing project conventions. Do not overwrite an existing model, generated directory, or package configuration without showing the intended change.

## Install ModelLang

ModelLang requires Node.js 20 or newer.

1. Verify registry availability with `npm view modellang version`.
2. If it succeeds, install the requested version or the latest available version as a development dependency:
   - npm: `npm install --save-dev modellang`
   - pnpm: `pnpm add --save-dev modellang`
   - yarn: `yarn add --dev modellang`
   - bun: `bun add --dev modellang`
3. Verify with the locally installed executable: `npx --no-install modelc --help`.
4. If the registry returns `E404` or `E403`, explain that the unscoped package is not currently available. Do not substitute a similarly named package. Offer to work from the official source repository only if the user wants that development workflow.

Never install `model-lang`, `@atlanticplatformgroup/modellang`, or another package as a substitute for `modellang` unless the user explicitly requests it.

## Create or edit a model

1. Ask for or infer only the minimum domain facts needed: entities, important fields, caller identities, allowed operations, authorization rules, invariants, and multi-entity effects.
2. Inspect existing models and the version-matched language specification before using unfamiliar syntax.
3. Prefer the smallest coherent model that demonstrates the user's real domain. Avoid generic demo entities when actual requirements are available.
4. Put caller identity in `caller` parameters. Never model trusted identity as ordinary client-supplied action input.
5. Express authorization, preconditions, invariants, and atomic effects explicitly rather than leaving them in comments.
6. Run `modelc check <file>` after each meaningful edit and fix diagnostics before generating output.

For a new project, use `app.model` unless the repository has a stronger naming convention. Do not add stable declaration IDs speculatively; use `modelc assign-ids <file>` when identity is needed for semantic evolution.

## Inspect and explain

Use the narrowest command that answers the question:

```text
modelc check <file>
modelc print-ir <file>
modelc explain <file>
```

Explain the model in domain language first, then describe compiler artifacts. Clearly distinguish modeled guarantees from responsibilities left to the host, including database connectivity, migrations, authentication, secrets, extension implementations, monitoring, and HTTP hosting.

## Generate the application boundary

1. Choose a repository-appropriate output directory, normally `generated/<app>`.
2. Run `modelc build <file> --out <directory>`.
3. Report the important generated surfaces: canonical IR, PostgreSQL enforcement, typed TypeScript interfaces, OpenAPI, operations metadata, MCP/agent contracts, enforcement documentation, and provenance.
4. Treat generated files as compiler-owned. Change the model and regenerate instead of editing generated output.
5. Run the project's relevant tests after generation.

Only add `--agent-plugin-url` when the user has a real deployed MCP endpoint. The generated Agent Plugin contains connection metadata, not credentials, and does not deploy or authenticate the application.

## Evolve an existing model

Preserve a known-good previous IR before changing the model. Use:

```text
modelc semantic-diff <previous-ir.json> <current.model> --out <semantic-diff.json>
modelc migration <previous-ir.json> <current.model> --out <migration.sql>
modelc reviewed-migration <previous-ir.json> <current.model> --plan <reviewed-plan.json> --out <migration.sql>
```

Review semantic changes and generated SQL before application. Never apply a migration or modify a live database unless the user explicitly asks and the target is unambiguous.

## Finish with evidence

Report:

- what was installed or changed;
- the model and output paths;
- exact validation/build commands run and their results;
- any host-runtime responsibilities that remain; and
- any preview-version or npm-availability limitation encountered.

Do not claim success based only on writing a file. A successful modeling task includes at least `modelc check`; a generation task includes a successful `modelc build` and inspection of the expected output.
