# Changelog

## 0.6.0

- Extended `@stableId(...)` to enums, enum members, invariants, temporal exclusions, actions, and queries.
- Added canonical IR version 6 with ID-based enum types, enum literals, operation ownership, rule IDs, enforcement entries, and action audit identities.
- Extended `modelc assign-ids` to every durable declaration supported by 0.6.
- Added identity-based rename planning for invariant and exclusion constraints and action/query PostgreSQL functions.
- Recognized enum declaration renames as semantic-only and made enum-member renames fail closed until stored-value migrations are supported.
- Migrated both canonical models to complete explicit declaration identity.
- Added unit and live PostgreSQL tests for stable reference lowering, complete ID assignment, broad rename planning, data preservation, constraint renames, and callable function renames.

## 0.5.1

- Prevented managers and finance users from approving their own purchase requests through both action authorization and a durable invariant.
- Added a durable approval-authority invariant that validates snapshotted roles against the approved amount.
- Made request-opening authorization explicit for employee, manager, and finance roles rather than relying on seed-data role combinations.
- Added generated-artifact, database-backstop, role-independence, and self-approval regression coverage.

## 0.5.0

- Added persistent `@stableId(...)` identities for entities and stored fields.
- Added canonical IR version 5 with identity strategy metadata and ID-based entity/field references.
- Added `modelc assign-ids`, which assigns missing cryptographically random IDs in place and is idempotent.
- Added deterministic previous-IR/current-source migration comparison.
- Added transactional PostgreSQL table and column rename generation.
- Made generated action and query routines replaceable for post-migration redeployment.
- Added fail-closed migration refusal for name-derived IDs, additions, removals, structural changes, and collisions.
- Migrated both canonical models to explicit stable IDs.
- Added unit and live PostgreSQL tests proving a renamed table/foreign-key column preserves data and enforcement.

## 0.4.0

- Added normative stored `Set<Enum>` fields and membership expressions.
- Added canonical IR version 4 with explicit enum-set types and `setMembership` semantics.
- Added PostgreSQL `text[]` storage with constraints rejecting undeclared, null, and duplicate members.
- Added fail-closed `member in set` lowering to PostgreSQL array membership.
- Extended `@snapshot` to copy complete enum sets as point-in-time audit context.
- Generated enum-union arrays in TypeScript entity types.
- Migrated Procurement from one mutually exclusive role to multi-role principals.
- Added compiler, codegen, database-constraint, multi-role authorization, and set-snapshot tests.

## 0.3.0

- Added normative authenticated query syntax and canonical IR version 3.
- Added query authorization, fail-closed row filters, direct-field ordering, deterministic ID tie-breakers, and compile-time limits.
- Added generated `SECURITY DEFINER` PostgreSQL query functions returning bounded JSON arrays.
- Removed direct entity-table `SELECT` from the application role; generated actions and queries are now the complete runtime database boundary.
- Added typed query inputs and array-returning methods to generated TypeScript clients.
- Added query nodes and read-policy entries to Mermaid and enforcement artifacts.
- Added caller-isolation, resource-isolation, missing-entity, direct-read denial, and query compiler conformance tests.

## 0.2.0

- Added normative versioned language, grammar, conformance, and unstable-boundary documents.
- Added canonical IR version 2.
- Added required `DateTime` ordering semantics.
- Added `exclusion ... noOverlap(key, start, end)` with half-open interval semantics.
- Added PostgreSQL strict-interval checks and atomic GiST exclusion constraints.
- Added generated `ConflictError` mapping for SQLSTATE `23P01`.
- Added the Reservations canonical application, generated artifacts, demo, and real concurrency tests.
- Preserved Procurement as the 0.1 compatibility application.
- Changed generated golden output to per-model subdirectories.

## 0.1.0

- Established the Procurement proof of concept and authenticated PostgreSQL enforcement boundary.
