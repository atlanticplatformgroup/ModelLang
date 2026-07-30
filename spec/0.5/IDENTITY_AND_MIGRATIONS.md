# ModelLang 0.5 — Stable Identity and Rename Migrations

Status: normative design contract for the 0.5 reference compiler.

## Semantic identity

Names are editable labels. Stable IDs identify declarations across model versions.

```modellang
entity PurchaseRequest @stableId("ent_7d617d617d617d617d617d617d617d61") {
  requestedBy: User @stableId("fld_8a928a928a928a928a928a928a928a92");
}
```

`@stableId` is supported on entities and stored fields. Entity IDs use `ent_` followed by 32 lowercase hexadecimal characters; field IDs use `fld_` followed by 32 lowercase hexadecimal characters. Values are globally unique within a model.

The canonical IR prefixes these values by declaration kind:

```text
entity:ent_7d617d617d617d617d617d617d617d61
field:fld_8a928a928a928a928a928a928a928a92
```

References in IR use these IDs. Current names remain in IR for diagnostics, generated API names, and physical SQL naming.

For source compatibility, declarations without `@stableId` still compile with name-derived identity. Rename migration planning requires explicit stable IDs on every entity and field in both compared models.

## Assigning IDs

The reference CLI provides:

```bash
modelc assign-ids model.model
```

It assigns cryptographically random IDs to missing entities and fields, preserves existing IDs, and rewrites the source file in place. Re-running it is idempotent.

## Migration comparison

The reference CLI compares a previously released IR with current source:

```bash
modelc migration previous-model.ir.json current.model --out migration.sql
```

The previous IR is the deployment baseline, not a live-database guess.

Declarations match exclusively by stable ID. A name and SQL-name change with the same ID is a rename. The 0.5 planner supports:

- entity name changes that map to table renames;
- field name changes that map to column renames;
- any combination of non-colliding entity and field renames.

Output is deterministic transactional PostgreSQL DDL. A field rename preserves its stored values, nullability, constraints, indexes, and foreign-key attachment because PostgreSQL renames the existing column.

## Refusal policy

The 0.5 migration planner rejects:

- missing or name-derived IDs;
- changed stable IDs;
- added or removed entities or fields;
- type, optionality, default, storage, annotation, invariant, exclusion, action, query, model-name, or schema changes;
- rename targets colliding with an existing table or column;
- inputs other than canonical IR version 5.

It never guesses that an unmatched deletion and addition are a rename.

## Deployment boundary

The migration file handles table and column renames. Generated action/query functions use `CREATE OR REPLACE` and, with grants, must then be redeployed from the current IR. Automated deployment orchestration and physical constraint renaming are outside 0.5; PostgreSQL preserves existing constraint enforcement across table and column renames.
