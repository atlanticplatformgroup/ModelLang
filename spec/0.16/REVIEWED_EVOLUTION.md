# ModelLang 0.16 reviewed semantic evolution

Status: normative.

## 1. Two guarded paths

ModelLang has two distinct migration authorities:

1. `modelc migration` remains the automatic 0.10 safe-evolution planner. Its accepted change set and fail-closed rules are unchanged.
2. `modelc reviewed-migration` accepts a released canonical IR, current source, and a versioned reviewed plan. It may implement data-dependent or destructive changes only when the plan explicitly accounts for them.

`modelc semantic-diff` is non-mutating analysis. Semantic diff v2 declares `migrationAuthority: "separateGuardedMigrationPlanners"`; the report itself is never executable authority.

Failure of the safe planner does not authorize a reviewed migration. A reviewed plan is a separate, reviewable source artifact.

## 2. Plan document

A plan conforms to `schemas/reviewed-migration-plan.schema.json` and declares:

- plan format version 1 and strategy `transactionalRebuild`;
- a human review description;
- exact `from` and `to` model IDs, versions, and source hashes;
- semantic-change acknowledgements keyed by change kind and stable subject ID;
- typed per-field value sources for existing rows;
- stable-ID enum-member mappings.

Unknown keys are rejected. The format has no raw SQL, expression, hook, command, filename, or program field. JSON object-key order and the order of acknowledgement, field-value, enum, and enum-member entries do not affect its canonical SHA-256 hash.

Every non-additive semantic-diff entry must have exactly one acknowledgement. A persistent declaration removal must use `dataLossAccepted` or `transformed`; ordinary `accepted` is insufficient. Extraneous or duplicate acknowledgements fail closed. Git review, deployment approval, and organizational sign-off remain host governance concerns; the plan records intent but does not claim cryptographic approval identity.

## 3. Supported reviewed transformations

Reviewed migration plan v1 supports:

- removal of non-principal entities and fields with explicit data-loss acknowledgement;
- required-field backfills from a typed literal, a current enum member, or an identically typed previous field in the same entity;
- replacement or rename of scalar enum members through stable-ID mappings;
- new and changed invariants, uniqueness, bounds, exclusions, actions, queries, workflows, and transitions when current generated PostgreSQL can enforce them and existing copied rows validate;
- the complete additive and stable-rename set already represented by canonical IR9.

Database-owned UUID and timestamp values are copied for existing rows. They remain database-owned for new action execution. Caller identity remains authenticated context and cannot appear in a migration plan.

Plan v1 rejects:

- field-type transformations, even when PostgreSQL could cast them;
- enum-set member transformations;
- principal-entity replacement, model-identity replacement, or physical model/internal schema replacement;
- name-derived durable declarations;
- arbitrary SQL, external programs, imperative callbacks, or inferred rollback;
- any acknowledgement, mapping, or field value that cannot be matched by stable ID.

These rejections define the current implementation boundary, not a claim that the transformations are impossible in a future typed plan version.

## 4. PostgreSQL execution

The version-1 PostgreSQL strategy is an offline transactional rebuild:

1. Start one transaction and verify the installed model ID, version, and source hash.
2. Take access-exclusive locks on the previous model tables.
3. Create a deterministic staging schema and current constrained tables.
4. Copy every retained entity row using stable entity and field IDs, applying only declared value sources and enum mappings.
5. Validate row counts, field constraints, invariants, uniqueness, temporal exclusions, and foreign keys before replacement.
6. Replace the old model schema, restore internal principal references and workflows, and redeploy the complete current action/query/grant boundary.
7. Record the current model identity, version, source hash, migration kind `reviewed`, and canonical plan hash.
8. Commit.

Any error rolls back staging, replacement, generated callables, grants, and migration history together. In particular, a failed backfill or newly violated invariant leaves the old schema and rows intact.

The model schema is a generated-only boundary. Replacement explicitly drops the previously declared functions and tables without `CASCADE`, then requires the schema to be empty. Undeclared objects in the model schema or external database objects that depend on the old generated objects therefore block migration instead of being silently deleted.

The execution credential must have the same administrative authority required for installation plus permission to create, drop, rename, and assign ownership of schemas. The generated migration grants no persistent database-level creation authority to `modellang_owner`.

The staging rebuild intentionally favors correctness and inspectability over online availability. It acquires exclusive locks and copies retained tables. Online or phased migration strategies are not part of plan v1.

## 5. History and rollback

`schema_migrations` distinguishes `installation`, `safe`, and `reviewed` entries and stores a non-null `plan_hash` for reviewed entries. Baseline verification still uses the latest model ID, version, and source hash. The plan hash provides deployment provenance; it is not a signature.

ModelLang does not infer reverse transformations. A rollback that would discard or reconstruct business data requires its own forward reviewed plan from the installed version, or an operator-controlled database restore. The compiler must not claim reversibility merely because all DDL is transactional.
