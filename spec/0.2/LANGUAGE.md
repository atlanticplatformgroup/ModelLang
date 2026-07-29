# ModelLang 0.2 — Normative Core

Status: reference-compiler specification. Rules labeled unstable in `UNSTABLE.md` carry no compatibility guarantee.

## Compilation contract

A successful compilation produces canonical typed IR and target artifacts exclusively from that IR. Unsupported syntax or unenforceable rules are compilation errors. A backend may not silently omit a rule.

The 0.2 reference target is PostgreSQL. Generated state changes are callable only through action functions whose semantic caller is bound from authenticated `session_user`; caller identity is never a user-supplied action argument.

## Values and identity

The scalar types are `String`, `Int`, `Decimal`, `Boolean`, `UUID`, and `DateTime`. Fields may be optional with `?`. Named enums are closed string sets.

Entity values and entity references are UUID identities. Equality between compatible entity types compares primary keys, never structural field equality.

Nullable Boolean expressions use SQL strong-Kleene behavior internally. Authorization, preconditions, invariants, and generated constraint boundaries succeed only when exactly true.

## Stored entities

Every entity has exactly one required `UUID @id` field. Entity-typed fields are stored foreign-key identities.

Supported annotations:

- `@id`
- `@unique`
- `@min(number)`
- `@minExclusive(number)`
- `@max(number)`
- `@snapshot`

`@snapshot` is valid only on stored scalar or enum fields. It is never populated implicitly. An action must assign `null` or a direct field value; the value is copied into the row and later source changes do not propagate.

## Actions and authenticated callers

Every action has exactly one entity parameter marked `caller`. All callers in a model use the same principal entity type.

The caller remains available to action expressions but is absent from SQL and TypeScript callable signatures. PostgreSQL resolves it through an owner-controlled `session_user` binding before authorization.

An action contains one authorization rule, zero or more named preconditions, and exactly one single-entity create or update effect. Identity, locks, authorization, preconditions, effects, constraints, and audit insertion occur atomically in one function call.

## Invariants

An invariant is an entity-local Boolean expression. It may reference fields of its entity but may not traverse relationships. It compiles to a fail-closed table check constraint.

## Temporal exclusion

An entity may declare:

```modellang
exclusion ruleName:
  noOverlap(keyField, startsAtField, endsAtField);
```

Normative semantics:

- `keyField` is a required entity reference.
- Start and end are required `DateTime` fields.
- Each interval is half-open: `[start, end)`.
- Start must be strictly earlier than end.
- For any two rows with the same key identity, their intervals must not overlap.
- Adjacent intervals are permitted: `[10:00, 11:00)` and `[11:00, 12:00)`.
- Enforcement is atomic under concurrent inserts and updates.

The PostgreSQL backend emits a strict interval check plus a GiST exclusion constraint using `tstzrange(..., '[)')`. An exclusion violation has SQLSTATE `23P01` and maps to generated `ConflictError`.

## Enforcement and explanation

Every field rule, invariant, temporal exclusion, action guard, caller binding, row lock, effect, privilege boundary, and audit mechanism appears in `enforcement.json` and `enforcement.md` with its generated artifact and object.
