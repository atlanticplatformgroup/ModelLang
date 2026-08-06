# ModelLang 0.49 public preview distribution contract

## Package identity

The public preview package name is `modellang`, its executable name is `modelc`, and its license identifier is `Apache-2.0`. The package requires Node.js 20 or newer and uses public npm visibility.

The package version, compiler version, and current example-model versions are 0.49.0. Package identity does not alter canonical IR, source semantics, generated authority, or runtime behavior.

## Artifact closure

The npm tarball MUST contain:

- the package manifest, README, changelog, and Apache-2.0 license;
- compiled JavaScript, declarations, and source maps under `dist/src`;
- the complete `schemas` tree, including the runtime canonical IR schema and pinned external Agent Plugins schemas; and
- the `modelc` executable binding to `dist/src/cli.js`.

It MUST NOT contain repository tests, TypeScript repository scripts, committed generated applications, example source models, milestone plans, language specification history, editor metadata, or local logs.

Runtime schema lookup MUST resolve inside the installed package and MUST NOT depend on the source checkout. Runtime dependencies required by the compiler and its generated TypeScript application surface MUST be declared as package dependencies.

## Artifact proof

The repository health gate MUST create the real npm tarball, inspect its file inventory, install it into an empty temporary consumer, verify public identity and license metadata, run the installed compiler against the current Procurement model, build all generated artifacts, and generate a schema-shaped Agent Plugin connection package.

A source-checkout test or `npm pack --dry-run` listing alone is insufficient evidence because neither proves installed runtime schema resolution or executable behavior.

## Repository and release automation

Continuous integration MUST test supported Node 20 and Node 22 environments, deterministic generation, build, lint, dead code, package closure, agent evaluation, and unit behavior. A separate PostgreSQL 16 service MUST exercise live integration.

Tag-driven release automation MUST reject a Git tag that differs from `v<package-version>`, regenerate models without drift, run the full health gate with PostgreSQL, and publish the public package from a hosted runner. npm credentials or trusted-publisher setup remain repository-owner configuration and MUST NOT be committed.

## Preview compatibility

The public preview supports only exact canonical IR1. Pre-1.0 minor releases may make documented breaking changes and advance affected contract axes. Patch releases preserve the current minor's language and generated contracts except for compatible fixes. Only the latest preview minor receives security fixes.

Package publication, source hosting, npm-name ownership, deployment of generated applications, and third-party client installation are external state. They do not grant application authority or prove runtime conformance.
