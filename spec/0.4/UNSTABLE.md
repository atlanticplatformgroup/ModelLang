# ModelLang 0.4 unstable set boundaries

The following capabilities are intentionally undefined:

- sets of scalar or entity values;
- set literals and default values;
- set-valued action or query parameters;
- set-returning actions or queries;
- set equality or ordering;
- union, intersection, difference, subset, or cardinality operations;
- incremental set mutation;
- permission implication and role inheritance;
- permission relations backed by separate entities;
- migration semantics between singular enum and enum-set fields.

They must not be inferred from the 0.4 `Set<Enum>` syntax or membership operator.
