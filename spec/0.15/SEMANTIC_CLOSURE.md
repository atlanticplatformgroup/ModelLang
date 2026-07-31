# ModelLang 0.15 — Semantic closure, provenance, and change analysis

Status: normative design contract for the 0.15 reference compiler.

## Purpose and trust boundaries

ModelLang 0.15 makes the semantic content already present in canonical IR9 consumable by trusted engineering tools without widening the public browser or HTTP contracts.

The generated contracts have distinct purposes:

| Artifact | Audience | Authority |
|---|---|---|
| `model.ir.json` | Compiler backends and trusted analyzers | Canonical typed compiler boundary |
| `operations.json` | Transport generators, hosts, and clients | Static public operation shape; no policy internals |
| `ui.json` | Browser applications and renderers | Static presentation and structural workflow metadata; no authorization claim |
| `semantic.json` | Trusted engineering, review, assurance, and future capability-view compilers | Full static semantic closure; unfiltered, not current state, and not executable |
| `provenance.json` | CI, release, debugging, and artifact consumers | Deterministic compilation identity and hashes |

An implementation must not treat `semantic.json` as a browser contract, an authorization-filtered capability view, a preflight decision, or permission to execute. Runtime enforcement remains authoritative.

## Engineering semantic manifest version 1

`semantic.json` declares semantic manifest version 1 and the profile `sml-transactional-core/1`. It records:

- compiler and IR versions;
- model identity, model version, source hash, and source file;
- the authenticated principal entity and the fact that caller identity is never request supplied;
- each declared action and query by stable semantic ID and current name;
- callable input and output contracts from operation manifest v2;
- normalized typed authorization, precondition, and row-policy expressions from canonical IR;
- stable fact dependencies and source spans for each rule;
- action read sets, deterministic lock plans, entity effects, field assignments, linked invariants and exclusions, workflow transitions, and failure classes;
- query read sets, ordering, identity tie-breakers, bounds, and failure classes.

The manifest is derived from canonical IR9 and operation manifest v2. It contains no SQL names, database credentials, HTTP paths, UI components, current entity values, bearer credentials, or caller identity values.

The top-level view flags are normative:

```json
{
  "audience": "engineering",
  "view": {
    "authorizationFiltered": false,
    "currentState": false,
    "executable": false
  }
}
```

Consumers must fail closed on an unsupported semantic manifest version or profile. A future authorization-aware view must use a separate versioned contract and must not reinterpret these flags.

## Rule dependencies and read sets

Rule dependencies identify referenced parameters, fields, and enum members by canonical semantic ID. They are deterministic structural dependencies, not a proof that all values are available to a particular caller.

An action read set is the union of entities and fields referenced by authorization, preconditions, and assignment expressions. A query read set is the union referenced by query authorization and row policy. Read sets describe current ModelLang expression dependencies; they do not infer database query plans, hidden extension reads, or future external effects.

## Effects and postconditions

The semantic manifest exposes the existing bounded ModelLang effect algebra: one entity `create` or `update` with ordered field assignments. Update targets bind to a callable entity parameter by parameter ID. It also links every invariant and temporal exclusion on the affected entity as a durable postcondition enforced after the action effect.

Version 0.15 does not claim emitted events, external calls, deletion, idempotency, reversibility, compensation, or recovery semantics. Those require new language and IR contracts rather than inference from PostgreSQL output.

## Artifact provenance version 1

`provenance.json` records:

- compiler version;
- generator profile;
- model ID, name, version, and source hash;
- canonical IR version; and
- every other generated artifact's relative path, role, and SHA-256 content hash.

Roles are `canonical`, `contract`, `projection`, and `assurance`. The provenance catalog intentionally omits its own hash to avoid a recursive document. It contains no wall-clock generation timestamp, so identical compiler input produces byte-identical output.

The catalog proves artifact association and content identity. It is not a cryptographic signature or supply-chain attestation. Signing and independently deployed artifact negotiation remain host responsibilities.

## Semantic diff version 1

The command:

```text
modelc semantic-diff <previous-ir.json> <current.model> --out <semantic-diff.json>
```

produces a non-mutating stable-ID-aware report. It can report multiple changes even when the guarded migration planner would reject the first unsafe change.

Changes are classified as:

- `additive`;
- `restrictive`;
- `expansive`;
- `breaking`; or
- `review` when the current analyzer cannot prove direction or compatibility.

The report distinguishes identity, structure, validation, authorization, query visibility, lifecycle, effect, and persistence areas. It recognizes identity-preserving renames, declaration additions and removals, field-contract changes, invariant and exclusion changes, action/query shape changes, authorization changes, precondition additions/removals/changes, row-visibility changes, result-contract changes, effect changes, workflow changes, and lifecycle expansion or contraction.

The analyzer only directionally classifies authorization or row-policy changes when literal allow/deny structure proves the direction. It does not claim general logical implication. Ambiguous predicate or effect changes are `review`.

Semantic diff is analysis, not migration authority. Every report declares `migrationAuthority: "separateSafeMigrationPlanner"`. Only `modelc migration` applies the narrower 0.10 safe-evolution rules and emits transactional PostgreSQL changes.

## Version preservation

Operation manifest v2 and UI manifest v2 remain byte-compatible with 0.14 for the same canonical IR. The semantic manifest, provenance catalog, and semantic diff use independent version numbers so their evolution does not implicitly change HTTP or browser contracts.
