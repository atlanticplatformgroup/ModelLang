# ModelLang 0.16 unstable evolution boundaries

The 0.16 contracts deliberately do not stabilize:

- online, phased, expand-contract, or zero-downtime reviewed migrations;
- field-type conversion functions, collection transformations, row-conditional expressions, joins, aggregation, or external backfill programs;
- inferred down migrations, automatic compensation, database backup, or recovery orchestration;
- plan signatures, approver identities, remote attestation, deployment registries, or environment promotion records;
- alternate-backend reviewed execution or backend-neutral physical migration steps;
- data profiling, cost estimates, lock-duration forecasts, or automatic batching;
- principal replacement, schema movement, model/package identity replacement, federation, or cross-context data transfer;
- general logical implication proving for changed predicates;
- every boundary already listed as unstable in 0.15.

The current transactional rebuild is deliberately offline and PostgreSQL-first. It must not be represented as a zero-downtime or backend-neutral migration protocol.
