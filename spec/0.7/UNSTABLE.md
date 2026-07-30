# ModelLang 0.7 unstable generated-value boundaries

The following remain undefined:

- generation strategies other than `uuid` and `now`;
- sequences, numeric identities, ULIDs, custom functions, expressions, and user-defined generators;
- client-generated or runtime-generated authority;
- statement-time, wall-clock, commit-time, or externally synchronized timestamps;
- generated optional fields or nullable generator results;
- inferred snapshot sources or automatic snapshot population;
- immutable enforcement against database owners, superusers, migrations, or other elevated direct SQL;
- generated columns derived from other columns;
- changing generation or mutability through an automatic migration;
- server-managed update timestamps and optimistic-concurrency versions.
