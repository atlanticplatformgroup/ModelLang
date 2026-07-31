# ModelLang 0.17 unstable applicability boundaries

The 0.17 contracts deliberately do not stabilize:

- the opaque revision encoding or PostgreSQL row-version algorithm;
- cache lifetime, subscriptions, push invalidation, offline applicability, or cross-request locking;
- bulk applicability, list-level capability filtering, partial input, hypothetical state, or proposed-value simulation;
- query applicability, field-level visibility, resource discovery, or existence-disclosure policy other than the default denial projection;
- localized explanation text, arbitrary reason payloads, full decision traces, evaluated values, or policy debugging over public transport;
- reusable source-level policy declarations or a general policy runtime;
- capability delegation, signed capability tokens, reservations, leases, idempotency keys, or proof-carrying authorization;
- agent task packets, MCP tools, autonomous planning, or direct use of the enforcement decision plan by agents;
- alternate-backend decision execution or a backend-neutral revision algorithm;
- every boundary already listed as unstable in 0.16.

These omissions are intentional. Applicability is a current authenticated advisory query; execution remains the sole authority.
