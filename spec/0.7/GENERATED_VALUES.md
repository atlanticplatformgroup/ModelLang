# ModelLang 0.7 — Generated Values and Immutability

Status: normative design contract for the 0.7 reference compiler.

## Stored-field annotations

`@generated(strategy)` declares a stored field whose initial value is supplied by the database during a create effect. Version 0.7 supports exactly:

- `@generated(uuid)` on a required `UUID` field;
- `@generated(now)` on a required `DateTime` field.

A generated field:

- may not be optional;
- may not declare a source-language default;
- may not also be `@snapshot`;
- may not appear on the left side of a create or update assignment;
- is implicitly immutable, whether or not `@immutable` is also written;
- is included in the entity returned by a successful action.

`@immutable` declares a stored field that an update effect may not assign. A create effect may explicitly assign a non-generated immutable field. Writing `@immutable` beside `@generated` is valid and documents the implicit guarantee.

These restrictions are ModelLang action semantics. Elevated database authorities remain outside the generated application boundary.

## Database authority

Generation is part of the PostgreSQL transaction that creates the row:

- `uuid` lowers to `DEFAULT pg_catalog.gen_random_uuid()`;
- `now` lowers to `DEFAULT pg_catalog.transaction_timestamp()`.

An action insert omits generated columns and uses `RETURNING *`, so PostgreSQL is the sole authority for their initial values and the typed client receives the committed representation. If every field is generated or has a database default, the insert uses `DEFAULT VALUES`.

`now` is the PostgreSQL transaction timestamp. Multiple `@generated(now)` values created in one transaction therefore share the transaction start time. Version 0.7 does not define a wall-clock or statement-time strategy.

## Distinction from snapshots

Generation and snapshots have different dataflow:

- `@generated` asks the database to originate a value during creation; an action cannot assign it.
- `@snapshot` asks an action to copy an explicitly named direct field value; later source changes do not propagate.
- `@immutable` constrains later ModelLang updates and does not originate or copy a value.

The compiler never infers a snapshot source and never auto-populates a snapshot.

## Canonical IR

IR version 7 records generation separately from source defaults:

```json
{
  "generation": {
    "strategy": "uuid",
    "authority": "database"
  },
  "mutability": "immutable"
}
```

Every field has `mutability` equal to `mutable` or `immutable`. Generated fields also carry a `generated:<field-id>` enforcement entry, and immutable fields carry an `immutable:<field-id>` entry. Backends must reject IR that lacks either required target.

Generation strategy and mutability are field structure for migration comparison. Changing either is a semantic change, not a rename.
