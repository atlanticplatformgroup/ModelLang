# Conditional field disclosure

## Projection contract

A projection member may opt into conditional disclosure by placing `redactable` after the optional stable-ID position:

```model
projection RequestSummary @stableId("prj_request_summary") from Request {
  id @stableId("pfd_request_summary_id");
  amount @stableId("pfd_request_summary_amount") redactable;
  status @stableId("pfd_request_summary_status");
}
```

`redactable` is part of the reusable projection contract. As elsewhere in the language, omitted explicit identity is deterministically derived; when `@stableId(...)` is authored it must precede `redactable`. The field's JSON key remains required, but its output type becomes nullable in every generated consumer contract. A model cannot promise a non-null field in one query and silently weaken that same projection in another.

## Query rules

A query may declare up to 32 disclosure rules after `where` and before `orderBy`:

```model
query myRequests(caller actor: User)
  returns RequestSummary from Request as request {
  authorize true;
  where request.requester == actor;
  disclose amount when request.status != RequestStatus.DRAFT;
  orderBy request.createdAt desc;
  limit 50;
}
```

The path starts at the query's return projection and names authored projection member names. It may continue only through explicit nested-projection members. Entity traversal, source-field paths, aliases, collections, and runtime-selected paths are invalid. The target must be marked `redactable`, paths are unique per query, and every condition must type-check as Boolean in the ordinary query scope: source row, authenticated caller, declared inputs, literals, enum members, and reusable policies.

Rules are query-local. Reusing a projection in another query does not copy or infer any rule. A redactable field without a rule is always redacted.

## Fail-closed result semantics

For each redactable field, the generated result always contains its declared JSON key. The value is the ordinary projected value only when the matching condition evaluates exactly true. False, SQL unknown, or no rule yields JSON `null`. No sentinel string, omitted key, alternate shape, or redaction-reason object is produced.

For a nested path such as `owner.role`, every redactable ancestor needs its own rule. The descendant can be visible only when its own condition and every enclosing redaction boundary allow construction of the containing object. This keeps nested disclosure explicit and finite.

Disclosure is weaker than authorization. A rule cannot make a query callable, add a row, bypass the row policy, select an undeclared projection member, change ordering or limits, or authorize an action. Conditions may read hidden enforcement fields without disclosing them.

## Static lowering and derived contracts

PostgreSQL lowers each rule to a static expression equivalent to:

```sql
CASE WHEN (<authored condition>) IS TRUE
  THEN <statically generated projected value>
  ELSE NULL
END
```

No caller-controlled field path, JSON key, expression, or SQL fragment reaches generation or execution. Operation and UI manifests identify redactable fields and publish per-query rule IDs under a null-redaction, fail-closed contract. OpenAPI and generated TypeScript make the field nullable, while HTTP output validation still requires the key and rejects undeclared sentinel encodings. Engineering semantics and enforcement evidence retain the rule expression, dependencies, source span, and exact output path.

## Evolution and pagination

Changing a projection member between ordinary and `redactable` changes the reusable output type and is breaking. Adding a rule makes previously redacted values potentially visible and is expansive. Removing a rule is restrictive. A condition change is classified by its Boolean semantic direction when the compiler can prove one; otherwise it requires review.

The complete disclosure-rule contract participates in a paginated query's revision. A changed rule invalidates older cursors, and each page re-resolves the principal and re-evaluates authorization, row visibility, and field disclosure under the current database statement snapshot.

Released IR9 through IR23 baselines normalize to non-redactable projection members and no disclosure rules. Evolution never fabricates nullable fields or disclosure authority for historical models.
