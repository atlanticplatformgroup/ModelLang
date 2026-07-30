# ModelLang 0.6 unstable identity and migration boundaries

The following remain undefined:

- explicit stable IDs on model declarations, parameters, preconditions, assignments, and query clauses;
- enum-member stored-value migrations;
- adding or removing declarations;
- field type, nullability, default, and annotation migrations;
- data backfills and user-authored migration blocks;
- rename-cycle resolution;
- automatic replacement of schema constraints whose expressions changed;
- complete deployment orchestration, migration history, rollback, locking, and online rollout policy;
- introspecting a live database as the semantic baseline.
