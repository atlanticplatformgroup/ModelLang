# ModelLang 0.18 unstable policy boundaries

The 0.18 contracts deliberately do not stabilize:

- structured policy return payloads, deny branches, scores, obligations, arbitrary reasons, or user-authored evidence payloads;
- multiple authority-bearing policy calls in one action authorization or priority-based overlap resolution;
- optional, collection, generic, higher-order, dynamically selected, recursive, effectful, or externally implemented policies;
- public policy IDs, branch IDs, evaluated values, full traces, policy-debug endpoints, or evidence export APIs;
- retention duration, redaction, encryption, legal-hold, archival, or external audit-system integration;
- signed evidence, delegated authority, proof-carrying authorization, capability tokens, reservations, or leases;
- alternate enforcement backends or backend-neutral evidence/revision encodings;
- MCP/agent generation, task packets, autonomous planning, or direct agent consumption of the internal decision plan;
- every boundary already listed as unstable in 0.17.

These omissions are intentional. Policy v1 closes exact executed authority for the bounded PostgreSQL profile without widening the public capability surface.
