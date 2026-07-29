# Changelog

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
