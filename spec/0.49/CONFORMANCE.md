# ModelLang 0.49 conformance

A conforming implementation:

1. implements the complete ModelLang 0.48 language and conformance requirements;
2. changes no source grammar, canonical IR, authority surface, generated application contract, MCP runtime, or freshness contract for public packaging;
3. identifies the public npm artifact as `modellang@0.49.0`, binds `modelc`, requires Node.js 20 or newer, and declares Apache-2.0;
4. packs compiled source modules, declarations, source maps, complete schemas, README, changelog, license, and package metadata while excluding repository-only tests, scripts, generated examples, plans, and specification history;
5. resolves canonical IR validation from the clean-installed package rather than a source checkout;
6. proves the tarball by clean installation, installed `modelc check`, installed `modelc build`, and installed Agent Plugin generation;
7. provides supported-Node CI, deterministic generation drift detection, full local quality checks, and live PostgreSQL integration;
8. provides tag/version-checked public npm release automation without committing registry credentials;
9. documents contribution, private vulnerability reporting, release, preview installation, host responsibility, and pre-1.0 compatibility boundaries; and
10. emits compiler/package/examples 0.49.0 while retaining canonical IR1, generator profile `/32`, MCP adapter v6, catalog v7, target profile v9 and target `/9`, Agent Plugins 1.0.0, and every existing runtime envelope and assurance format version.
