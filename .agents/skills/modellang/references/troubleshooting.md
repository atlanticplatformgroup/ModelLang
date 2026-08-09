# ModelLang troubleshooting

## `npm view modellang version` returns E404 or E403

The unscoped npm package is not available from the current registry. Confirm the active registry with `npm config get registry` and authentication with `npm whoami`, but do not install a similarly named package. If npm reports name similarity, only the package owner and npm Support can resolve it.

## `modelc` is not found

Confirm that `modellang` is in the target project's development dependencies and use its local binary:

```bash
npx --no-install modelc --help
```

Do not depend on a global installation. In the ModelLang source checkout, build first and invoke `node dist/src/cli.js`.

## Node.js is too old

ModelLang requires Node.js 20 or newer. Report the detected version and let the user choose how to upgrade their runtime; do not silently replace their Node installation.

## The parser rejects syntax

Run `modelc check <file>` without redirecting stderr. Compare the syntax with the version-matched language specification and working examples. Do not assume syntax from Prisma, GraphQL, SQL, or another modeling language is accepted by ModelLang.

## A build fails after a valid check

Run the same command with `--debug`, retain the complete diagnostic, and inspect the requested output path. Check permissions and whether another process is using the destination. ModelLang replaces generated output atomically; do not repair a partial output directory by hand.

## Generated code appears wrong or incomplete

Inspect `model.ir.json`, enforcement documentation, operations metadata, and provenance before concluding generation failed. Confirm that the desired rule is explicit in the model. Change the model and rebuild rather than editing generated files.

## Authentication or authorization does not work at runtime

Separate compile-time contracts from host responsibilities. Verify that the host authenticates the credential, enforces the expected audience, binds caller identity into the database session, uses the generated operation boundary, and prevents application roles from mutating model tables directly. Never accept a trusted ModelLang principal ID from request input.

## A migration is risky

Generate and inspect a semantic diff first. Preserve the previous canonical IR, review generated SQL, and use a reviewed migration plan for changes that require explicit operator decisions. Do not execute the migration against a live database without direct authorization and a clearly identified target.
