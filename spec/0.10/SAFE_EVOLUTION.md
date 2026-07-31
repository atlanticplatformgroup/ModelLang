# ModelLang 0.10 — Safe Schema Evolution

Status: normative design contract for the 0.10 reference compiler.

## Baseline and identity

`modelc migration <previous-ir.json> <current.model>` compares declarations by stable semantic ID. Both inputs must use canonical IR version 9 and every durable declaration in both inputs must have an explicit stable ID.

The model ID, model name, generated schemas, and principal entity must remain unchanged. The current model must declare a different version.

Every generated installation has an owner-controlled internal `schema_migrations` table. It records model ID, model version, source hash, and application time. A migration:

1. creates and bootstraps the history table when upgrading a pre-0.10 installation;
2. verifies that the latest recorded model ID, version, and source hash exactly match the supplied previous IR;
3. applies schema changes and redeploys the callable boundary in one transaction;
4. records the current version and source hash before commit.

A baseline mismatch fails with SQLSTATE `55000` and `ML_MIGRATION_BASELINE:<expected-hash>`. No migration operation is applied.

The first migration from an older installation necessarily trusts the operator-selected previous IR because that database has no earlier ModelLang history record.

## Safe additions

Version 0.10 automatically plans:

- new enum declarations;
- new members appended to existing enums;
- new entities, including their fields, invariants, exclusions, and foreign keys;
- new fields on existing entities when nullable or backed by a constant/database-generated default;
- new actions and queries;
- new workflows;
- new transitions appended to existing workflows;
- the stable declaration renames already supported by 0.9, except workflow physical-name changes.

New enum members refresh every existing scalar and set constraint that uses that enum. New workflow transitions replace the owner-controlled trigger function while preserving its triggers. New actions, queries, fields, and entities cause the complete current action/query/grant boundary to be redeployed inside the same transaction.

New entities are empty, so their complete declared constraints can be installed safely. Tables are created before cross-entity foreign keys, allowing references among newly added entities.

## Added-field proof

An added field on an existing entity is accepted only when existing rows have a defined valid value:

- an optional field receives `NULL`;
- a required field has a compile-time constant default; or
- a required field uses `@generated(uuid)` or `@generated(now)`.

An added `@unique` field is rejected because uniqueness depends on stored row count and values. Numeric or money defaults that violate their declared min/max annotation are rejected before SQL generation.

## Refused changes

Version 0.10 fails closed on:

- removal or stable-ID replacement of any existing durable declaration;
- existing field type, optionality, default, annotation, storage, generation, or mutability changes;
- existing action, query, invariant, exclusion, workflow-target, initial-state, or transition-edge changes;
- enum-member renames or removals;
- required added fields without defaults or database generation;
- added unique fields on populated entity types;
- adding invariants or temporal exclusions to an existing entity;
- workflow, target entity, or target field renames that change generated workflow physical names;
- principal or model identity changes.

These operations require a reviewed migration with explicit data transformation semantics and are not silently approximated.

## Transaction and deployment

Generated migration SQL orders operations as follows:

1. optional extension installation;
2. baseline-history bootstrap and verification;
3. stable physical renames;
4. new semantic enums and members;
5. new tables;
6. new fields and constraints;
7. foreign keys for new entities;
8. refreshed enum constraints;
9. new or refreshed workflow functions and triggers;
10. complete action, query, and grant redeployment;
11. target-history insertion;
12. commit.

Any PostgreSQL failure rolls back the complete migration, including its history record.
