# Authenticated current-state agent resources

## Purpose

ModelLang 0.40 gives an authenticated agent a standardized current-state representation without creating a second read model. Each resource is backed by one declared query, so its authorization, row policy, closed projection, conditional disclosure, ordering, bound, pagination, and optional private read evidence remain authoritative.

## Binding

Every query tool in agent catalog v3 declares an authenticated `POST /agent/resources/queries/<stable-query-id>` binding. The request body is exactly the query's existing closed input, including authored sort and cursor fields where declared, and never accepts caller identity. Action IDs have no resource route.

The resource route rejects `If-Match`, idempotency, correlation, and causation headers. It invokes the query through the existing executor, validates the exact bounded result, and returns `Cache-Control: no-store`. If the query fails authentication, authorization, identity binding, input validation, or cursor validation, no resource envelope is returned.

## Envelope

Resource envelope v1 contains:

- exact model and stable query identity;
- `kind: "queryResult"` and `authority: "none"`;
- flags stating that the result is subject-specific, authorization-filtered, current-state-bearing, input-free, authenticated-identity-free, extension-free, and non-authoritative;
- point-in-time freshness metadata;
- the exact query result as `data`.

The envelope does not echo query input, bearer identity, extension metadata, policy expressions, SQL/runtime details, or private read evidence. Modeled projection fields may contain domain identifiers or other explicitly authorized values; the identity exclusion applies to the authenticated transport identity, not to author-declared query data.

## Freshness

The runtime records `retrievedAt` after the query result has been returned and validated. This is a transport retrieval timestamp, not a database commit timestamp, frozen snapshot identifier, as-of guarantee, or revision token.

Freshness is deliberately conservative:

- `mode` is `pointInTime`;
- `maxAgeSeconds` is `0`;
- `revalidate` is `beforeReuse`;
- HTTP storage is prohibited with `Cache-Control: no-store`.

Consumers may reason about the returned state for the current interaction, but must read again before reusing it. Any later action independently reloads state and re-enforces all runtime rules. A resource and an action capability view are not an atomic snapshot and neither grants authority.

## Evidence and pagination

An opted-in audited query produces its ordinary private transactional read evidence when invoked as a resource. The envelope never exposes that evidence. A paginated query returns its ordinary bounded page and opaque next cursor as `data`; every page retrieval is a separate point-in-time resource read under the cursor's existing binding and staleness rules.
