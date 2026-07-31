# ModelLang 0.15 unstable semantic boundaries

The 0.15 contracts deliberately do not stabilize:

- authorization-filtered runtime capability manifests;
- side-effect-free applicability or preflight decisions;
- missing-fact, denial-explanation, freshness, or capability-token semantics;
- policy redaction and purpose-scoped disclosure;
- first-class named policies or reusable decision clauses;
- structured approval-decision evidence and policy-version audit records;
- events, external operations, deletion, idempotency, reversibility, compensation, and recovery;
- extension contracts or an extension ledger;
- explicit stable model/package identity independent of model name;
- target capability profiles or alternate enforcement backends;
- logical implication proving for arbitrary authorization, validation, or row-policy changes;
- cryptographic signing, remote attestation, artifact negotiation, or deployment registries;
- semantic presentation annotations, localization, confirmation, destructive-operation, or product overlay formats;
- agent/MCP generation and federation packages or processes.

The engineering semantic manifest is not a public or agent-facing authorization contract. Consumers that expose it outside a trusted engineering boundary are non-conforming.
