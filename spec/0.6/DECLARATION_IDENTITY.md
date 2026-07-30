# ModelLang 0.6 — Declaration Identity and Renames

Status: normative design contract for the 0.6 reference compiler.

## Stable declarations

Names are editable labels. Stable IDs are persistent semantic identities.

Version 0.6 supports `@stableId` on:

- enums (`enm_`);
- enum members (`emv_`);
- entities (`ent_`);
- stored fields (`fld_`);
- invariants (`inv_`);
- temporal exclusions (`exc_`);
- actions (`act_`);
- queries (`qry_`).

Every prefix is followed by exactly 32 lowercase hexadecimal characters. Values are unique within a model and cannot be reused by another declaration.

```modellang
enum Role @stableId("enm_11111111111111111111111111111111") {
  MANAGER @stableId("emv_11111111111111111111111111111111")
}

action approve @stableId("act_11111111111111111111111111111111")(
  caller actor: User,
  request: Request
) -> Request {
  authorize Role.MANAGER in actor.roles;
  update request { status = Status.APPROVED; }
}
```

Declarations without an explicit ID remain source-compatible and compile with name-derived identity. Migration planning requires explicit IDs on every supported declaration in both inputs.

## Canonical IR

Canonical IR version 6 stores identity metadata independently from declaration names. Enum types refer to enum IDs. Enum literals refer to both enum and enum-member IDs. Entity types, field access, action/query parameters, rules, locks, effects, ordering, enforcement entries, and audit records use semantic IDs.

Names remain present only where they are required for diagnostics, source expressions, and generated SQL or TypeScript labels.

An action rename therefore does not change its audit identity. An enum rename does not change the type identity of fields using that enum. An invariant or exclusion rename does not create a new rule.

## Assigning IDs

`modelc assign-ids model.model` assigns cryptographically random IDs to every missing supported declaration. Existing IDs are preserved. Re-running the command is idempotent.

## Rename migrations

Migration comparison matches declarations only by stable ID. Version 0.6 supports:

- entity names as PostgreSQL table renames;
- field names as PostgreSQL column renames;
- invariant names as PostgreSQL check-constraint renames;
- temporal-exclusion names as both exclusion-constraint and valid-interval constraint renames;
- action and query names as PostgreSQL function renames using their exact caller-free signatures;
- enum declaration names as semantic renames with no stored PostgreSQL operation, because the current backend stores member values as constrained text.

Migration output is deterministic and transactional. Current generated action functions, query functions, and grants are redeployed after the structural rename file.

## Refusal policy

The 0.6 planner rejects:

- missing or name-derived IDs;
- changed IDs, additions, or removals;
- semantic or structural changes;
- enum-member renames, even when their stable identity is recognized;
- colliding physical rename targets;
- model or schema changes;
- rename cycles;
- inputs other than canonical IR version 6.

Enum-member rename refusal is intentional. Stored scalar values, enum-set arrays, defaults, invariants, and generated routines may all mention a member’s SQL value. Version 0.6 will not partially migrate that graph.
