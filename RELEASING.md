# Releasing ModelLang

ModelLang releases are immutable npm packages and matching Git tags. The public package is `@atlanticplatformgroup/modellang`; its executable is `modelc`.

## One-time repository setup

1. Create the public source repository and set it as this checkout's Git remote.
2. Enable private vulnerability reporting.
3. Confirm that the publishing account belongs to the `atlanticplatformgroup` npm organization and can publish `@atlanticplatformgroup/modellang`.
4. For the first publication, add a short-lived granular `NPM_TOKEN` repository secret with publish permission. After the package exists, configure npm trusted publishing for `release.yml`, allow `npm publish`, remove the secret, and revoke the token. Trusted publishing requires Node 22.14+ and npm 11.5.1+; the release job uses Node 24 and installs current npm.
5. Protect `main` and require the CI workflow.

## Release checklist

1. Confirm `package.json`, `src/version.ts`, examples, changelog, specification, and generated artifacts use the intended version.
2. Run:

   ```bash
   npm ci
   npm run model:check
   npm run model:generate
   git diff --exit-code
   npm run db:up
   npm run health
   npm pack --dry-run
   ```

3. Confirm the worktree is clean and the release commit is on `main`.
4. Create and push an annotated tag matching the package version, for example `v0.49.0`.
5. The release workflow verifies the tag/version match, reruns the full live suite, and publishes through the configured npm credential path. Trusted publishing automatically records npm provenance for a public package from a public repository.
6. Verify `npm view @atlanticplatformgroup/modellang version`, install the published version in an empty directory, and repeat the quickstart from [Public Preview](./docs/PUBLIC_PREVIEW.md).

Publishing is intentionally separate from compiling or generating an Agent Plugin. Neither a package, Git tag, nor plugin installation grants application authority.
