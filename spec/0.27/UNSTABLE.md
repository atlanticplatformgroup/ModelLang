# ModelLang 0.27 unstable boundaries

The following remain outside the stable contract: public runtime failure inspection, HTTP or agent failure tools, notifications, alerts, dashboards, retention and archival duration, materialized historical snapshots, full-text error detail, payload inspection, broker introspection, batch recovery, automated recovery, operator approval workflows, cross-model operations, and distributed tracing.

The snapshot cutoff bounds when a row became terminal; it is not a database-wide materialized snapshot. A row that is recovered during traversal disappears from subsequent pages. Observation audit records inspection, not acknowledgement, ownership, assignment, approval, or recovery authority.

The stable guarantee is bounded, deterministic, minimally projected, separately authorized, and privately audited discovery of current PostgreSQL-local terminal failures.
