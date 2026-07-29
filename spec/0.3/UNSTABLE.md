# ModelLang 0.3 unstable read boundaries

The following query capabilities are intentionally undefined:

- optional query parameters;
- joins and relationship traversal;
- projections and field-level read authorization;
- aggregates, grouping, and distinct values;
- caller-selected sorting;
- cursor, keyset, or offset pagination;
- full-text search;
- read-audit retention and privacy policy;
- HTTP status and transport semantics;
- cache behavior and subscriptions;
- frontend view and routing metadata.

They must not be inferred from the initial query syntax. Each requires explicit type, authorization, IR, enforcement, and conformance semantics.
