# Authenticated subject capability views

## Purpose

The static agent catalog describes every declared tool but cannot answer whether one authenticated subject can apply one action to exact candidate input now. ModelLang 0.39 adds a narrow overlay over the existing authoritative action-applicability boundary. It is discovery assistance, not a capability token, execution grant, resource API, or policy evaluator separate from the generated runtime.

## Catalog contract

Agent catalog v2 declares `subjectView` only as an authenticated HTTP binding with these fixed properties:

- `POST /agent/capabilities`;
- subject-specific, authorization-filtered, and input-specific;
- action candidates only, at most 32 distinct declared action IDs;
- query tools remain `staticCatalogOnly`;
- no current resource state, extensions, expressions, or authority grant;
- runtime authorization remains required.

The static `tools` collection remains complete and unfiltered. Consumers combine it with the overlay by stable operation ID.

## Request

For a model with actions, the body is a closed object containing one to 32 candidates. Each candidate is a closed object containing:

- `operationId`: one declared action ID;
- `input`: the exact closed input object for that action, excluding caller identity;
- optional `expectedRevision`: one unquoted opaque `rev:1:` revision.

An action ID may occur only once per request. Query IDs, undeclared IDs, extra properties, malformed revisions, and malformed inputs are rejected before assessment. A query-only model accepts only `{ "candidates": [] }` and returns an empty view.

Bearer authentication is resolved before request-body validation. The endpoint rejects execution metadata headers (`If-Match`, `Idempotency-Key`, correlation, and causation); revision comparison belongs inside each candidate.

## Response

The closed `subject-capability-view` v1 response identifies the exact model and catalog version and partitions candidates into:

- `available`: applicable action ID, `authority: "none"`, and the opaque current revision;
- `unavailable`: denied, not-applicable, or stale action ID plus the already-filtered authorization, requirement, or revision explanation and a revision only where visibility permits.

Candidate input, authenticated identity, resource values, extensions, expressions, internal state, and private evidence are never echoed. The endpoint invokes applicability only and performs no action execution. Candidates are assessed in request order; the collection is not an atomic state snapshot and state may change between assessments or before execution.

Responses carry `Cache-Control: no-store`; hosts and clients must not persist or share the subject-specific overlay.

## Authority and freshness

An available entry is advisory and grants no authority. Action execution independently resolves current authenticated identity, reloads current state, and re-enforces authorization, requirements, workflow, invariants, revision checks, and concurrency controls. The returned revision can detect a subsequent change when explicitly supplied to execution, but it is not an authorization credential and has no promised lifetime.

Current-state resource representations and freshness contracts are outside 0.39.
