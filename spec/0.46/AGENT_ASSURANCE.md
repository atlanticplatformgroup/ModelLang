# ModelLang 0.46 adversarial agent assurance

## Purpose

The `agent-adversarial-v1` suite tests the existing public agent boundary as a hostile trust boundary. It does not ask a language model to behave safely and does not weaken runtime enforcement when metadata or planning context appears favorable.

The deterministic suite covers identity injection, malformed and widened inputs, operation-kind confusion, command metadata on reads, delegated credentials on non-actions, stale or cross-principal preflight reuse, request-context isolation, adapter substitution, invalid host results, private implementation disclosure, and MCP action/resource/packet/trace/extension separation. Live PostgreSQL coverage retains real authorization, row policy, revision, evidence, and audit behavior.

Discovery, applicability, current-state resources, task packets, public traces, extension registration, and synthetic evaluation results grant no authority. Core execution authenticates and re-enforces current rules. Host extension authorization remains request-bound. Delegated authority remains exact-action, exact-input, revision-bound, audience-bound, authenticated-delegate, single-use authority.

## SML-Agent assessment v1

Each generated model includes `sml-agent-assessment.json`. It is an assurance artifact, not an agent-facing capability or conformance certificate. It contains exactly the ten Appendix B.2 criteria, status, evidence references, explicit gaps, and a summary.

The assessment always declares:

- `overall: "partial"`;
- `authority: "none"`;
- no complete-conformance claim;
- no agent-competence claim;
- no test-execution attestation; and
- no included live-model result.

Generation may describe a suite contract that exists in the reference repository, but it cannot prove that a downstream build executed it. Artifact provenance classifies the assessment as assurance.
