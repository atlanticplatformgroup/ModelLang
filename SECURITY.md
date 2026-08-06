# Security policy

## Supported versions

ModelLang is pre-1.0. Security fixes are provided for the latest published minor release only. Generated applications remain responsible for their deployed identity provider, secrets, database operations, extension implementations, delegated-capability storage, network controls, monitoring, and incident response.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository host's private vulnerability-reporting or security-advisory flow and include:

- the affected ModelLang version and generated target;
- a minimal model or generated artifact that reproduces the issue;
- the expected and observed authorization or data boundary;
- whether PostgreSQL, HTTP, MCP, Agent Plugin packaging, delegation, or an extension host is involved; and
- any known exploitation prerequisites or mitigations.

Reports should receive an acknowledgement within seven days. Disclosure timing will be coordinated after impact and a remediation path are understood.

## Security boundaries

Tool catalogs, Agent Plugin packages, applicability results, task packets, public traces, and static discovery caches grant no authority. A report that shows metadata being treated as identity or authority is security-relevant. Host-owned credentials, OAuth configuration, extension code, deployment infrastructure, and third-party agent clients are outside the generated implementation, but integration flaws at those boundaries are still useful to report.
