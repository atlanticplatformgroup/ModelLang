# ModelLang 0.5 unstable migration boundaries

The following remain undefined:

- stable IDs on enums, enum members, actions, queries, rules, or exclusions;
- adding, removing, or changing fields and entities;
- type and nullability migrations;
- enum-member migrations;
- data backfills and user-authored migration blocks;
- rename-cycle resolution;
- automatic constraint-name normalization;
- automatic replacement of generated functions and grants;
- migration history, rollback, locking, and online deployment policy;
- introspecting a live database as the semantic baseline.
