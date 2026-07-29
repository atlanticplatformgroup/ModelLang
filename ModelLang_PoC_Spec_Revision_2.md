# ModelLang Proof of Concept — Language and Compiler Specification

**Status:** Implementation-ready proof-of-concept specification  
**Revision:** 2 — authenticated caller binding, explicit nullable semantics, lock-dependency analysis, and deterministic concurrency tests  
**Working name:** ModelLang  
**Primary implementation language:** TypeScript  
**Primary execution target:** PostgreSQL  

## 1. Mission

Build a small model-first language and compiler that proves one concrete claim:

> A business/domain ontology can be compiled into an enforcement boundary that constrains application behavior, rather than serving only as documentation.

The proof of concept must let a developer define entities, relationships, invariants, authenticated principals, authorization rules, preconditions, and state-changing actions in one source file. The compiler must produce:

1. a canonical intermediate representation;
2. PostgreSQL schema and constraints;
3. PostgreSQL action functions that bind the authenticated database session to a model principal and enforce permissions and valid state transitions;
4. a generated TypeScript client with no unrestricted mutation API and no caller-supplied actor identifier;
5. a graph representation of the same model; and
6. an explanation map showing exactly where every declared rule is enforced.

The system is successful when forbidden behavior is rejected even when ordinary application code attempts it, concurrent calls race, or a caller tries to act as a different model user.

## 2. Core design principle: the enforcement boundary

An ontology cannot restrain arbitrary code that has unrestricted authority. Therefore, the proof of concept must establish a trusted boundary:

- Application requests execute through an authenticated PostgreSQL login principal.
- Each application login is a member of a restricted, non-login execution role named `modellang_app`.
- A source parameter marked with the `caller` modifier is derived from `session_user` through an owner-controlled principal-binding table; it is never accepted as a caller-supplied UUID.
- Application principals may read model data and execute generated action functions.
- Application principals may not directly insert, update, delete, or truncate entity rows.
- Generated action functions run with narrowly controlled elevated privileges.
- Database constraints enforce entity-local invariants regardless of which generated action caused a write.
- Generated lock plans stabilize every mutable entity row used by authorization, preconditions, or effects before those expressions are evaluated.

The compiler must never claim a rule is enforced unless it emits a corresponding enforcement mechanism. Unsupported rules are compilation errors, not warnings and not ignored metadata.

### 2.1 Security guarantee and trust boundary

The proof of concept demonstrates this scoped guarantee:

> For a session authenticated as a provisioned application login that possesses only the privileges of `modellang_app`, every generated state change is attributed to the model principal bound to that login and is constrained by the compiled authorization, precondition, invariant, locking, and privilege rules.

The guarantee does not claim to constrain a PostgreSQL superuser, the generated-object owner, or an operator using migration credentials. PostgreSQL deliberately allows those authorities to bypass ordinary application boundaries.

The implementation and README must state these operational assumptions explicitly:

- `modellang_owner` is `NOLOGIN`.
- Ordinary application processes never connect as a superuser, `modellang_owner`, or a migration role.
- Application login roles are not members of `modellang_owner` and cannot `SET ROLE` into it.
- Elevated migration credentials are isolated from the ordinary application runtime.
- Principal-binding rows are provisioned only through a trusted administrative path.
- The proof establishes policy enforcement after database authentication; it does not solve password, secret, or infrastructure compromise.

For the proof of concept, one PostgreSQL login per demo user is the identity adapter. A production system may replace that adapter with a trusted gateway or verifiable identity assertion, but it must preserve the property that the action caller cannot choose an arbitrary principal ID.

## 3. Scope

### 3.1 In scope

- One source language stored in `.model` files.
- Scalar types: `String`, `Int`, `Decimal`, `Boolean`, `UUID`, and `DateTime`.
- Enumerations.
- Entities.
- Required and optional fields.
- Entity references as foreign keys.
- Field annotations: `@id`, `@unique`, `@min(...)`, `@minExclusive(...)`, `@max(...)`, and `@snapshot`.
- Action caller modifier: `caller`.
- Constant default values.
- Entity-local invariants.
- Actions with:
  - scalar and entity parameters;
  - exactly one authenticated caller parameter;
  - one authorization rule;
  - zero or more named preconditions;
  - exactly one create or update effect;
  - one returned entity value.
- A small, statically typed expression language with explicit nullable Boolean semantics.
- Deterministic JSON intermediate representation.
- PostgreSQL code generation.
- PostgreSQL principal binding based on `session_user`.
- Compile-time lock-dependency analysis and deterministic generated lock plans.
- TypeScript client generation.
- Mermaid graph generation.
- Rule-to-enforcement explanation generation.
- Parser, semantic, code-generation, security, and real concurrency integration tests.
- A complete procurement approval example.

### 3.2 Explicitly out of scope

- A general-purpose programming language.
- User-defined loops, recursion, functions, or arbitrary code blocks.
- Arithmetic expressions, computed fields, tax calculations, currency conversion, or string operations.
- Natural-language authoring.
- A visual editor.
- Bidirectional synchronization from generated code back into the model.
- Distributed transactions.
- Multiple storage engines.
- Schema migration planning or production-safe migrations.
- Row-level read authorization.
- Multi-entity atomic effects.
- Delete actions.
- Lists, collections, inheritance, traits, or generics.
- External service calls.
- Event sourcing.
- Performance optimization beyond correctness.
- Production identity federation, token verification, credential rotation, or connection-pooling architecture.
- Protection against PostgreSQL superusers, object owners, or compromised migration credentials.
- LLVM or MLIR integration.

Do not broaden the proof of concept until all acceptance tests in this specification pass.

## 4. Demonstration domain

The included example models purchase requests with these rules:

1. Employees can open purchase requests.
2. Only the request owner can submit a draft request.
3. A manager may approve a submitted request worth at most 10,000.
4. Finance may approve a submitted request worth more than 10,000.
5. An approved request must record both its approver and the approver's role.
6. Ordinary application code cannot directly modify a purchase request row.
7. An authenticated application login cannot impersonate another model user by supplying an actor ID.
8. Two concurrent approvals of the same submitted request cannot both succeed.

This domain is intentionally small but demonstrates data structure, business policy, authorization, state transitions, and database enforcement.

---

## 5. Example source program

Create `examples/procurement.model` with the following source:

```modellang
model Procurement version "0.1.0";

enum Role {
  EMPLOYEE,
  MANAGER,
  FINANCE
}

enum RequestStatus {
  DRAFT,
  SUBMITTED,
  APPROVED
}

entity User {
  id: UUID @id;
  name: String;
  role: Role;
}

entity PurchaseRequest {
  id: UUID @id;
  requester: User;
  amount: Decimal @minExclusive(0);
  status: RequestStatus = RequestStatus.DRAFT;
  approvedBy: User?;
  approvedByRole: Role? @snapshot;

  invariant approval_fields_match_status:
    (
      status == RequestStatus.APPROVED
      and approvedBy != null
      and approvedByRole != null
    )
    or
    (
      status != RequestStatus.APPROVED
      and approvedBy == null
      and approvedByRole == null
    );
}

action openRequest(
  caller actor: User,
  id: UUID,
  amount: Decimal
) -> PurchaseRequest {
  authorize actor.role == Role.EMPLOYEE;
  require positive_amount: amount > 0;

  create PurchaseRequest {
    id = id;
    requester = actor;
    amount = amount;
    status = RequestStatus.DRAFT;
    approvedBy = null;
    approvedByRole = null;
  }
}

action submitRequest(
  caller actor: User,
  request: PurchaseRequest
) -> PurchaseRequest {
  authorize actor == request.requester;
  require is_draft: request.status == RequestStatus.DRAFT;

  update request {
    status = RequestStatus.SUBMITTED;
  }
}

action approveRequest(
  caller actor: User,
  request: PurchaseRequest
) -> PurchaseRequest {
  authorize
    (request.amount <= 10000 and actor.role == Role.MANAGER)
    or
    (request.amount > 10000 and actor.role == Role.FINANCE);

  require is_submitted: request.status == RequestStatus.SUBMITTED;

  update request {
    status = RequestStatus.APPROVED;
    approvedBy = actor;
    approvedByRole = actor.role;
  }
}
```

---

## 6. Surface language

### 6.1 Lexical rules

- Source encoding: UTF-8.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.
- Keywords are lowercase and reserved.
- Type, entity, and enum names conventionally use PascalCase.
- Field, parameter, action, invariant, and precondition names conventionally use camelCase or snake_case.
- String literals use double quotes.
- Line comments begin with `//`.
- Whitespace is insignificant except as token separation.
- Semicolons are mandatory after fields, rules, and assignments.
- Names are case-sensitive.

### 6.2 Grammar outline

The implementation may use a handwritten recursive-descent parser. The accepted grammar must be equivalent to the following EBNF outline:

```ebnf
program          = model_decl, { declaration } ;

model_decl       = "model", IDENT, "version", STRING, ";" ;

declaration      = enum_decl | entity_decl | action_decl ;

enum_decl        = "enum", IDENT, "{", IDENT,
                   { ",", IDENT }, [ "," ], "}" ;

entity_decl      = "entity", IDENT, "{",
                   { field_decl | invariant_decl }, "}" ;

field_decl       = IDENT, ":", type_ref, [ "?" ],
                   [ "=", expression ], { annotation }, ";" ;

annotation       = "@id"
                 | "@unique"
                 | "@min", "(", NUMBER, ")"
                 | "@minExclusive", "(", NUMBER, ")"
                 | "@max", "(", NUMBER, ")"
                 | "@snapshot" ;

invariant_decl   = "invariant", IDENT, ":", expression, ";" ;

action_decl      = "action", IDENT, "(", [ parameter_list ], ")",
                   "->", IDENT, "{",
                   authorize_stmt,
                   { require_stmt },
                   effect_stmt,
                   "}" ;

parameter_list   = parameter, { ",", parameter } ;
parameter        = [ "caller" ], IDENT, ":", type_ref ;

authorize_stmt   = "authorize", expression, ";" ;
require_stmt     = "require", IDENT, ":", expression, ";" ;

effect_stmt      = create_stmt | update_stmt ;

create_stmt      = "create", IDENT, "{", { assignment }, "}" ;
update_stmt      = "update", IDENT, "{", { assignment }, "}" ;
assignment       = IDENT, "=", expression, ";" ;

type_ref         = scalar_type | IDENT ;
scalar_type      = "String" | "Int" | "Decimal" | "Boolean"
                 | "UUID" | "DateTime" ;

expression       = or_expr ;
or_expr          = and_expr, { "or", and_expr } ;
and_expr         = unary_expr, { "and", unary_expr } ;
unary_expr       = [ "not" ], comparison ;
comparison       = primary, [ comparison_op, primary ] ;
comparison_op    = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
primary          = literal | path | "(", expression, ")" ;
path             = IDENT, { ".", IDENT } ;
literal          = STRING | NUMBER | "true" | "false" | "null" ;
```

The parser must record source spans for all declarations and expressions. The `caller` modifier is reserved and may appear only on action parameters.

---

## 7. Static semantics

### 7.1 Symbol resolution

The compiler must build symbol tables for:

- model;
- enums and enum members;
- entities and fields;
- actions and parameters;
- invariants and preconditions.

Duplicate declarations are errors. Unknown names are errors. Forward references between top-level declarations are allowed.

### 7.2 Entity rules

- Every entity must contain exactly one `@id` field.
- The `@id` field must have type `UUID` and may not be optional.
- Entity fields must have unique names.
- Entity-typed fields compile to foreign keys.
- `@min`, `@minExclusive`, and `@max` are valid only on `Int` and `Decimal` fields.
- `@unique` is not valid on optional fields in this proof of concept.
- `@snapshot` is valid only on stored scalar and enum entity fields. It marks a persisted point-in-time audit value, not a live relationship-derived value. A snapshot is populated only when an action explicitly assigns `null` or a direct field value such as `actor.role`; the compiler never auto-populates it. The assigned value is copied into the target row, and later changes to the source field never propagate.
- Defaults must be compile-time constants of the declared type.
- An optional field may default to `null`.
- A required field may not default to `null`.

### 7.3 Expression types and nullable Boolean semantics

The type checker must track both the base type and nullability of every expression.

- `and`, `or`, and `not` require Boolean operands; operands may be nullable Boolean values.
- Ordering comparisons require compatible numeric operands.
- Equality requires the same scalar type, the same enum type, or compatible entity/reference types.
- Comparing an entity value to an entity reference compares IDs.
- Entity equality is primary-key identity equality; ModelLang never expands `leftEntity == rightEntity` into a comparison of every field.
- Qualified enum members use `EnumName.MEMBER` syntax.
- Unqualified enum member references are rejected.
- The null literal may appear only as one side of `==` or `!=`, and the other side must be optional.
- `optionalValue == null` and `optionalValue != null` are non-nullable Boolean expressions.
- Any other comparison involving an optional operand produces a nullable Boolean result.
- Nullable Boolean operations use SQL-compatible strong Kleene semantics: `not unknown` is unknown; `false and unknown` is false; `true and unknown` is unknown; `true or unknown` is true; and `false or unknown` is unknown.
- No arithmetic, concatenation, function call, or string-operation expression is accepted in this proof of concept.
- An authorization rule, precondition, or invariant succeeds only when its final result is exactly `TRUE`. `FALSE` and `UNKNOWN` both fail closed.

The type-level null rules and the SQL fail-closed boundary are complementary, not redundant. The type checker rejects nonsensical source expressions and records nullability. The PostgreSQL backend still emits `IS TRUE` at every rule boundary so that SQL `NULL`, backend mistakes, schema drift, or future nullable extensions can never count as success.

### 7.4 Invariant restrictions

Entity invariants may reference only fields of the entity containing the invariant. They may compare entity-reference fields for equality or nullness, but may not dereference related entities.

Examples:

- Allowed: `approvedBy != null`.
- Allowed: `status != RequestStatus.APPROVED or approvedBy != null`.
- Rejected: `approvedBy.role == Role.MANAGER`.

This restriction ensures every invariant can be compiled into a PostgreSQL table check constraint. The compiler must reject any invariant it cannot enforce.

### 7.5 Action and principal rules

- Every action has exactly one parameter marked with the `caller` modifier.
- The `caller` modifier is valid only on an entity-typed action parameter.
- All caller parameters in one model must have the same entity type.
- The caller parameter remains part of the semantic action signature and may be referenced by authorization, preconditions, and effects.
- The caller parameter is omitted from the generated SQL and TypeScript callable parameter lists.
- The PostgreSQL backend resolves the principal from the authenticated `session_user` through the generated principal-binding table.
- An action may not use its caller parameter as the update target in this proof of concept.
- Every action has exactly one `authorize` statement.
- Every action has exactly one effect: either `create` or `update`.
- Every `require` statement has a unique name within its action.
- Non-principal entity parameters are represented at runtime by their IDs and loaded by the generated action function.
- A create effect must assign every required field that has no default.
- A create effect may not assign undeclared fields.
- An update effect target must name a non-principal entity-typed action parameter.
- Updates may not change an `@id` field.
- Assignments must be type- and nullability-compatible.
- The action return type must match the entity created or updated.
- Guards may reference action parameters and direct fields on entity parameters.
- Effects may reference action parameters and direct fields on entity parameters.
- Transitive relationship traversal such as `request.requester.role` is rejected in this proof of concept. An entity-reference field may be compared by identity, but its target row may not be dereferenced.
- An action may create or update only one entity instance.

### 7.6 Fail-closed enforcement analysis

After type checking, classify every rule into an enforcement target:

- field requiredness -> PostgreSQL `NOT NULL`;
- entity reference -> PostgreSQL foreign key;
- `@unique` -> PostgreSQL unique constraint;
- `@min` / `@minExclusive` / `@max` -> PostgreSQL check constraint;
- `@snapshot` -> canonical IR storage semantics and generated client documentation; the stored column is populated only by the generated action effect;
- entity invariant -> PostgreSQL check constraint;
- caller parameter -> PostgreSQL `session_user` lookup plus owner-controlled principal binding;
- action authorization -> generated PostgreSQL function guard;
- action precondition -> generated PostgreSQL function guard;
- action effect -> generated PostgreSQL insert or update;
- mutable guard dependency -> generated PostgreSQL row lock;
- restricted mutation authority -> PostgreSQL roles, privileges, and generated functions.

If a rule has no supported enforcement target, compilation fails with an `E3xxx` enforcement error.

### 7.7 Lock-dependency analysis

For each action, the compiler must calculate every existing mutable entity row whose ID or fields are read by authorization, preconditions, or effect expressions.

The generated lock plan must follow these rules:

- The update target receives a `FOR UPDATE` lock.
- Every other mutable entity parameter read by a guard or effect receives at least a `FOR SHARE` lock so concurrent changes to guard-relevant fields cannot commit during evaluation.
- The authenticated principal entity row is included whenever the action reads the principal ID or any principal field.
- If the same row is required at multiple lock strengths, use the strongest lock.
- The query that resolves the model principal from the principal-binding row acquires a `FOR SHARE` lock on that binding row.
- Entity rows are acquired in a deterministic global order based on entity qualified ID and row UUID, independent of source parameter order. This order must be represented in the IR.
- All required locks must be acquired before any authorization or precondition is evaluated and before any effect expression is evaluated.
- A generated function must obtain the value used for evaluation from the lock-bearing query itself, or discard and reload any earlier value after the lock. A record loaded before its required lock may never be used for guard evaluation.
- If the compiler cannot identify or implement a complete lock plan, compilation fails rather than emitting a potentially racy action.

This proof of concept handles row dependencies that are statically identifiable from entity parameters. Predicate locks, collection queries, aggregates, and phantom-sensitive rules are out of scope.

## 8. Canonical intermediate representation

### 8.1 Purpose

The IR is the source for every backend. Code generators must not inspect parser AST nodes directly.

### 8.2 Format

Emit `generated/model.ir.json` and validate it against `schemas/model-ir.schema.json`.

Minimum top-level shape:

```json
{
  "irVersion": 1,
  "model": {
    "name": "Procurement",
    "version": "0.1.0",
    "sourceHash": "sha256:..."
  },
  "principal": {},
  "enums": [],
  "entities": [],
  "actions": [],
  "enforcement": []
}
```

### 8.3 Required IR properties

- Every declaration has a stable qualified ID such as `entity:PurchaseRequest`.
- Every field has an ID such as `field:PurchaseRequest.status`.
- Every rule has an ID such as `invariant:PurchaseRequest.approved_requires_approver`.
- The model records the single principal entity type.
- Every action records its semantic caller parameter separately from its callable parameters.
- Callable parameters exclude the caller parameter.
- Every action includes a deterministic lock plan with row source, entity ID, lock mode, and canonical acquisition order.
- Expressions are normalized typed trees, not source strings.
- Every expression node records both base type and nullability.
- Explicit null-comparison nodes remain distinguishable so backends can emit `IS NULL` and `IS NOT NULL`.
- All names needed by backends are present in normalized form.
- SQL identifiers are included only in a target-specific naming section, not mixed into semantic identity.
- Source spans are retained for diagnostics and traceability.
- Enforcement entries include principal binding and lock-plan mechanisms in addition to source-declared rules.
- Arrays are emitted in deterministic source order unless a documented canonical sort order is required, such as lock acquisition.
- JSON formatting is deterministic.

Example normalized expression node:

```json
{
  "kind": "binary",
  "operator": "==",
  "type": "Boolean",
  "nullable": false,
  "left": {
    "kind": "fieldAccess",
    "parameter": "actor",
    "fieldId": "field:User.role",
    "type": "enum:Role",
    "nullable": false
  },
  "right": {
    "kind": "enumLiteral",
    "enumId": "enum:Role",
    "member": "EMPLOYEE",
    "type": "enum:Role",
    "nullable": false
  }
}
```

Example action lock-plan fragment:

```json
{
  "callerParameterId": "parameter:approveRequest.actor",
  "callableParameters": ["parameter:approveRequest.request"],
  "lockPlan": [
    {
      "source": "parameter:approveRequest.request",
      "entityId": "entity:PurchaseRequest",
      "mode": "update"
    },
    {
      "source": "caller",
      "entityId": "entity:User",
      "mode": "share"
    }
  ]
}
```

## 9. Compiler architecture

Implement these stages as separately testable modules:

1. **Lexer** — source text to tokens with spans.
2. **Parser** — tokens to syntax AST.
3. **Resolver** — declarations and path resolution.
4. **Type checker** — expression and assignment typing.
5. **Enforcement and lock-plan analyzer** — verifies that every rule has a backend mechanism and computes stabilized action read sets.
6. **IR lowerer** — typed AST to canonical IR.
7. **PostgreSQL backend** — IR to SQL.
8. **TypeScript backend** — IR to generated client and types.
9. **Graph backend** — IR to Mermaid.
10. **Explain backend** — IR enforcement entries to Markdown and JSON.
11. **CLI** — check, build, print-ir, and explain commands.

No backend may silently skip an unsupported node.

---

## 10. PostgreSQL backend

### 10.1 Generated files

Emit:

```text
generated/postgres/001_roles.sql
generated/postgres/002_schema.sql
generated/postgres/003_actions.sql
generated/postgres/004_grants.sql
generated/postgres/005_seed.sql
```

The seed file is example-only and is not derived from the ontology. The integration harness may create local-only demo login roles before applying the seed file; passwords must not be committed to generated artifacts.

### 10.2 Naming

- Model schema: `model_<snake_case_model_name>`.
- Internal schema: `model_<snake_case_model_name>_internal`.
- Entity tables: singular snake case, such as `purchase_request`.
- Entity references: `<field_name>_id` only when needed to avoid ambiguity; document the convention and use it consistently.
- Constraints and functions must have deterministic names.
- All generated SQL must schema-qualify application and internal objects.

### 10.3 Type mapping

| ModelLang | PostgreSQL |
|---|---|
| `String` | `text` |
| `Int` | `bigint` |
| `Decimal` | `numeric` |
| `Boolean` | `boolean` |
| `UUID` | `uuid` |
| `DateTime` | `timestamptz` |
| enum | `text` plus named `CHECK` constraint |
| entity reference | `uuid` plus foreign key |

Text-plus-`CHECK` for enums is a deliberate proof-of-concept tradeoff. It favors simple deterministic DDL and explicit, flexible migrations over PostgreSQL-level enum type identity. It is not an accidental omission of native PostgreSQL enum types.

### 10.4 Entity constraints

Generate:

- primary keys;
- `NOT NULL` constraints;
- foreign keys;
- unique constraints;
- min/max checks;
- enum-member checks;
- entity-invariant checks.

Compile Boolean invariant expressions as `CHECK ((<sql expression>) IS TRUE)` so `NULL` never counts as success.

### 10.5 Roles, authenticated principals, and privileges

Create or document these roles:

- `modellang_owner`: `NOLOGIN`; owns generated schemas, tables, and functions.
- `modellang_app`: `NOLOGIN`; shared execution role granted to authenticated application login roles.
- local demo login roles such as `ml_employee_one`, `ml_employee_two`, `ml_manager`, and `ml_finance`; created as `LOGIN INHERIT` roles by the integration harness and granted membership only in `modellang_app`.

Generate an owner-controlled principal-binding table in the internal schema with a shape equivalent to:

```sql
CREATE TABLE model_procurement_internal.principal_binding (
  database_principal name PRIMARY KEY,
  principal_id uuid NOT NULL UNIQUE
    REFERENCES model_procurement."user"(id)
);
```

Requirements:

- The table is owned by `modellang_owner`.
- `modellang_app` and its login members receive no direct privileges on the internal schema or binding table.
- Binding rows are inserted only by trusted seed or provisioning code running with owner-level administrative authority.
- Generated action functions resolve the caller with `session_user`, never `current_user`; `current_user` becomes the function owner inside a `SECURITY DEFINER` function.
- An unbound login is rejected before authorization evaluation.

The generated grants must:

- revoke `CREATE` on the model and internal schemas from `PUBLIC`, `modellang_app`, and application login roles;
- grant model-schema usage to `modellang_app`;
- grant only the entity read access required by the demo;
- revoke direct `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on entity tables from `modellang_app` and all application login roles;
- revoke all access to the internal schema from public and application roles;
- revoke default public function execution;
- grant `EXECUTE` only on generated action functions to `modellang_app`;
- ensure application login roles are not members of `modellang_owner` and cannot `SET ROLE` into it.

The integration tests must verify these restrictions using the actual authenticated demo login connections, not an owner connection pretending to be an application role.

### 10.6 Generated action functions

Generate one `SECURITY DEFINER` PostgreSQL function per action.

Requirements:

- Schema-qualify every application and internal object reference. Set a function-level safe `search_path` containing only `pg_catalog` and `pg_temp`, with `pg_temp` last; do not include `public` or any caller-writable schema.
- Do not use dynamic SQL.
- Omit the caller parameter from the SQL function signature.
- Resolve and `FOR SHARE` lock the principal-binding row by `session_user`.
- Load the bound principal entity and every non-principal entity parameter according to the IR lock plan.
- Use `FOR UPDATE` for the update target and at least `FOR SHARE` for other mutable guard dependencies.
- Acquire all locks in the canonical order encoded in the IR before evaluating authorization, preconditions, or effect expressions.
- Read guard-visible values from the lock-bearing query. Never authorize from a record loaded before its required lock.
- Missing entity parameters raise a not-found error.
- A missing principal binding raises SQLSTATE `42501` with a stable `ML_IDENTITY_UNBOUND` prefix.
- Authorization is tested as `(<authorization expression>) IS TRUE`; failure raises SQLSTATE `42501` with a stable machine-readable prefix.
- Every precondition is tested as `(<precondition expression>) IS TRUE`; failure raises a stable custom error containing the precondition name.
- Create or update executes only after all identity resolution, locks, authorization, and preconditions succeed.
- Return the resulting row as `jsonb`.
- Insert one successful action record into an internal audit table, including action ID, `session_user`, bound principal ID, target ID when applicable, and transaction timestamp.
- Rely on generated table constraints as the final invariant backstop.

Example logical SQL signature:

```sql
model_procurement.approve_request(
  p_request uuid
) returns jsonb
```

The semantic ModelLang action still has `caller actor: User`; only the callable ABI omits it.

### 10.7 Expression lowering

Support lowering for:

- scalar parameters;
- principal and non-principal entity IDs;
- direct entity parameter fields;
- enum literals;
- numeric, string, Boolean, and null literals;
- `and`, `or`, `not`;
- equality and ordering comparisons;
- entity-to-reference equality.

Mandatory null lowering rules:

- `value == null` -> `value IS NULL`;
- `value != null` -> `value IS NOT NULL`;
- never emit `= NULL` or `<> NULL`;
- nullable operations preserve SQL-compatible unknown semantics internally;
- authorization, preconditions, and invariants are wrapped with `IS TRUE` at their enforcement boundary.

Reject every expression form not explicitly supported. In particular, do not silently translate arithmetic, computed totals, string operations, or function calls.

## 11. Generated TypeScript client

### 11.1 Generated files

Emit:

```text
generated/typescript/types.ts
generated/typescript/errors.ts
generated/typescript/client.ts
generated/typescript/index.ts
```

### 11.2 Types

Generate:

- string-union types for enums;
- interfaces for entities;
- exact callable action parameter interfaces that exclude the caller parameter;
- action return types.

Example:

```ts
export type Role = "EMPLOYEE" | "MANAGER" | "FINANCE";

export interface PurchaseRequest {
  id: string;
  requester: string;
  amount: string;
  status: RequestStatus;
  approvedBy: string | null;
  approvedByRole: Role | null;
}
```

Represent PostgreSQL `numeric` as a string in the generated client to avoid implicit precision loss.

### 11.3 Client API and identity

Generate a client class with one method per action and no generic mutation method. The caller's model identity comes from the PostgreSQL credentials behind that client or query adapter, not from an action argument:

```ts
await employeeClient.openRequest({ id, amount });
await employeeClient.submitRequest({ request });
await managerClient.approveRequest({ request });
```

The generated interfaces and SQL calls must contain no `actor` field or actor UUID. Extra JavaScript object properties, if present at runtime, must never be forwarded to SQL.

The client may accept a `pg.Pool`, `pg.Client`, or minimal query adapter interface. The demo constructs separate adapters authenticated as the employee, manager, and finance database login roles. Credential issuance and production connection pooling are outside the generated client's scope.

Map database failures into typed errors:

- `IdentityBindingError`;
- `AuthorizationError`;
- `PreconditionError`;
- `InvariantError`;
- `NotFoundError`;
- `ModelDatabaseError`.

Include the model rule or precondition ID whenever available.

## 12. Graph and explanation outputs

### 12.1 Mermaid graph

Emit `generated/model.mmd` containing:

- entity nodes;
- reference edges;
- action nodes;
- `creates`, `reads`, and `updates` edges;
- invariant nodes connected to their entities;
- authorization/precondition nodes connected to their actions;
- principal nodes connected to actions that consume authenticated identity;
- an identity-binding node showing `session_user` -> principal mapping;
- lock-plan edges showing which entity rows an action stabilizes for shared read or update.

The graph need not be interactive. It must be generated exclusively from the IR.

### 12.2 Enforcement explanation

Emit both:

```text
generated/enforcement.json
generated/enforcement.md
```

For every declared rule and generated boundary mechanism, include:

- rule or mechanism ID;
- human-readable source expression or derived purpose;
- enforcement layer;
- generated artifact;
- generated object name;
- source location when one exists.

Example:

| Rule or mechanism | Layer | Generated enforcement |
|---|---|---|
| `caller:approveRequest.actor` | PostgreSQL session identity | `session_user` lookup in `model_procurement_internal.principal_binding` |
| `invariant:PurchaseRequest.approved_requires_approver` | PostgreSQL constraint | `ck_purchase_request_approved_requires_approver` |
| `authorize:approveRequest` | PostgreSQL action guard | `model_procurement.approve_request` |
| `require:approveRequest.is_submitted` | PostgreSQL action guard | `model_procurement.approve_request` |
| `lock:approveRequest.request` | PostgreSQL row lock | `FOR UPDATE` in `model_procurement.approve_request` |
| `lock:approveRequest.actor` | PostgreSQL row lock | `FOR SHARE` in `model_procurement.approve_request` |
| `boundary:PurchaseRequest.direct_write` | PostgreSQL privilege | application principals have no table DML |

The CLI command `modelc explain examples/procurement.model` must print this mapping in readable text.

This output is a primary feature, not optional documentation. It visibly connects ontology declarations and compiler-derived safety mechanisms to executable database enforcement.

## 13. CLI

Create an executable named `modelc` with these commands:

```text
modelc check <file>
modelc build <file> --out <directory>
modelc print-ir <file>
modelc explain <file>
```

Behavior:

- `check`: parse and validate only; nonzero exit on errors.
- `build`: run all stages and atomically replace the output directory only after success.
- `print-ir`: print canonical IR to stdout.
- `explain`: print rule-to-enforcement mapping.

Diagnostics must include:

- stable error code;
- file path;
- line and column;
- concise message;
- related declaration location when useful.

Example:

```text
E2104 examples/procurement.model:31:13
Cannot compare Role to RequestStatus.
  actor.role == RequestStatus.DRAFT
              ^^^^^^^^^^^^^^^^^^^
```

---

## 14. Repository structure

Use this structure or a very close equivalent:

```text
/
  README.md
  SPEC.md
  package.json
  tsconfig.json
  docker-compose.yml
  schemas/
    model-ir.schema.json
  examples/
    procurement.model
  src/
    cli.ts
    diagnostics.ts
    lexer.ts
    parser.ts
    syntax-ast.ts
    resolver.ts
    type-checker.ts
    enforcement-analyzer.ts
    ir.ts
    lower-to-ir.ts
    naming.ts
    codegen/
      postgres.ts
      typescript.ts
      mermaid.ts
      enforcement.ts
  scripts/
    demo.ts
    apply-generated-sql.ts
  tests/
    lexer.test.ts
    parser.test.ts
    resolver.test.ts
    type-checker.test.ts
    enforcement.test.ts
    codegen-postgres.test.ts
    codegen-typescript.test.ts
    integration/
      procurement.test.ts
      concurrency.test.ts
      identity.test.ts
  generated/
    .gitkeep
```

Use TypeScript in strict mode. Use a handwritten parser. Use `pg` for PostgreSQL access and a mainstream TypeScript test runner. Do not introduce an ORM.

---

## 15. Testing requirements

### 15.1 Unit tests

Cover at least:

- tokenization with spans;
- comments and whitespace;
- every declaration kind;
- `caller` modifier parsing and source spans;
- operator precedence;
- duplicate declarations;
- unknown types and names;
- invalid annotations;
- missing, duplicate, scalar, or inconsistent principal declarations;
- missing or duplicate entity IDs;
- field and default type mismatches;
- nullable-to-required assignment mismatches;
- enum mismatch;
- invalid null comparison;
- nullable Boolean result typing and strong Kleene propagation;
- explicit `IS NULL` and `IS NOT NULL` lowering;
- disallowed invariant dereference;
- disallowed transitive relationship traversal in action expressions;
- invalid action target;
- principal used as an update target;
- missing required create assignment;
- update of ID field;
- unsupported arithmetic or string expressions;
- unsupported enforcement form;
- lock-dependency discovery;
- strongest-lock selection for duplicate row dependencies;
- deterministic global lock ordering;
- principal omission from callable SQL and TypeScript parameters;
- deterministic IR;
- deterministic SQL;
- deterministic TypeScript output.

### 15.2 Golden tests

Store expected output fixtures for:

- `model.ir.json`, including caller/principal metadata and lock plans;
- generated PostgreSQL SQL;
- generated TypeScript types and client;
- Mermaid graph;
- enforcement Markdown.

A second compiler run over unchanged input must produce byte-identical output.

### 15.3 PostgreSQL integration tests

Using a real PostgreSQL container, prove all of the following:

1. Schemas, internal principal-binding table, generated functions, and grants install successfully.
2. A mapped employee login can open a positive-value request without supplying an actor UUID.
3. A request with a nonpositive amount is rejected.
4. A different mapped employee login cannot submit someone else's request.
5. The owner employee login can submit a draft request.
6. A mapped manager login can approve a submitted request worth 10,000 or less.
7. A mapped manager login cannot approve a submitted request worth more than 10,000.
8. A mapped finance login can approve a submitted request worth more than 10,000.
9. Approval records the principal ID and role derived from the authenticated session.
10. A generated entity invariant rejects an invalid approved row when attempted with owner-level test access.
11. An application login cannot directly `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` an entity table.
12. `modellang_owner` is `NOLOGIN`, and application logins cannot `SET ROLE` to it.
13. Application logins cannot read or mutate the internal principal-binding table.
14. An unbound login that is a member of `modellang_app` is rejected with `IdentityBindingError` before action authorization is evaluated.
15. Generated SQL functions have no actor UUID parameter or overload that accepts one.
16. The generated TypeScript client maps every expected database failure to the correct typed error.
17. A successful action writes exactly one audit record containing `session_user` and the bound principal ID.
18. **Stale-target race test:** connection A, using owner-level test authority, begins a transaction and locks a submitted 5,000 request. Connection B, authenticated as a manager, invokes approval and must block on the generated request lock. After the test confirms B is waiting, A changes the amount to 25,000 and commits. B must resume, evaluate the newly committed amount, and reject authorization. A pre-lock or stale in-memory copy must make this test fail.
19. **Stale-principal race test:** connection A locks the mapped manager's `User` row, changes the role to `EMPLOYEE`, and remains uncommitted. Connection B, authenticated as that manager login, invokes approval and must block on the generated principal-row lock. After A commits, B must resume using the new role and reject authorization.
20. **Concurrent approval test:** two sessions authenticated as the same valid manager concurrently approve the same submitted low-value request. Exactly one succeeds; the other fails the `is_submitted` precondition after obtaining the row lock; exactly one approval audit record is written.

The race tests must use explicit transaction barriers and verify lock waiting through PostgreSQL lock state, such as `pg_locks` or `pg_stat_activity`. A test that relies only on arbitrary sleeps is insufficient.

Integration tests must not mock PostgreSQL behavior.

## 16. Demo script

`npm run demo` must perform and print this sequence:

```text
1. Compile Procurement.model
2. Apply generated SQL
3. Create local demo login roles and provision principal bindings
4. Seed one employee, one second employee, one manager, and one finance user
5. Employee login opens a 5,000 request                  PASS
6. Owner employee login submits the request              PASS
7. Manager login approves the 5,000 request              PASS
8. Employee login opens a 25,000 request                 PASS
9. Owner employee login submits the request              PASS
10. Manager login attempts to approve 25,000             REJECTED as designed
11. Finance login approves 25,000                        PASS
12. Unbound login attempts an action                     REJECTED as designed
13. Application login attempts direct table UPDATE       REJECTED as designed
14. Print ontology rule -> identity/lock/enforcement mapping
```

No action call in the demo may pass an actor ID. The demo must exit nonzero on an unexpected result.

## 17. Package scripts

Provide scripts equivalent to:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "<test-runner>",
    "model:check": "modelc check examples/procurement.model",
    "model:generate": "modelc build examples/procurement.model --out generated",
    "db:up": "docker compose up -d db",
    "db:down": "docker compose down -v",
    "demo": "<run-demo-script>"
  }
}
```

The README must contain exact setup and execution commands and must work from a clean checkout.

---

## 18. Diagnostics and error-code families

Use stable families:

- `E1xxx`: lexical and syntax errors.
- `E2xxx`: resolution and type errors.
- `E3xxx`: unsupported or missing enforcement.
- `E4xxx`: code-generation errors.
- `E5xxx`: CLI and file-system errors.

Do not expose raw stack traces for expected user errors. Preserve stack traces for unexpected internal failures when a debug flag is enabled.

---

## 19. Security and correctness constraints

### 19.1 Generated object safety

- Generated privileged functions must use the fixed safe `search_path` defined in Section 10.6, and all model/internal object references must be schema-qualified.
- Generated SQL must not use dynamic SQL.
- Revoke public execution on generated functions before granting application access.
- Revoke schema `CREATE` privileges from public and application roles on every generated schema.
- The application execution role must not own generated objects.
- Application login roles must not receive direct table mutation privileges.
- All caller-supplied action parameters must be passed as bound query parameters by the TypeScript client.
- Generated constraint and function names must be deterministic and safely quoted.
- Compiler output must include the source model hash.
- The compiler must fail rather than downgrade a rule to documentation.

### 19.2 Authenticated principal binding

- Every action must have exactly one caller parameter.
- The principal must be derived from `session_user`; an arbitrary caller-provided UUID is forbidden.
- `session_user`, not `current_user`, is the authentication key inside `SECURITY DEFINER` functions.
- The principal-binding table and internal schema are inaccessible to application roles.
- An unbound database login fails before authorization or mutation.
- Audit records must capture both `session_user` and the resolved model principal ID.
- The generated client must omit the principal from its public action inputs and SQL calls.

### 19.3 Atomicity and TOCTOU prevention

- Every state-changing action must execute in one transaction and one generated function call.
- The principal-binding row and all mutable entity rows used by authorization, preconditions, or effects must be locked before those expressions are evaluated.
- Update targets use `FOR UPDATE`; other mutable guard dependencies use at least `FOR SHARE`.
- Locks must be acquired in a deterministic global order encoded in the IR.
- Guard evaluation must use values returned by lock-bearing queries. Loading a value before the lock and evaluating that stale copy is forbidden.
- Authorization and preconditions must be tested with `IS TRUE`; false and unknown both reject the action.
- Table constraints remain the final backstop after action guards.
- Deterministic race integration tests are required; SQL-text inspection alone does not establish concurrency correctness.

### 19.4 Operational scope

The enforcement guarantee assumes ordinary application traffic never authenticates as `modellang_owner`, a migration role, or a superuser. `modellang_owner` must be `NOLOGIN`; elevated credentials must be absent from the normal application runtime; and application login roles must have only `modellang_app` membership plus explicitly documented read privileges.

A compromised application principal can invoke every action granted to `modellang_app`, but it still cannot choose another model principal, directly mutate tables, or bypass generated guards. A compromised owner or superuser is outside this proof's threat model.

This proof of concept is not a production security product, but it must not undermine its own central enforcement claim.

## 20. Definition of done

The implementation is complete only when:

- all unit, golden, identity, privilege, and real PostgreSQL integration tests pass;
- both deterministic stale-read race tests pass;
- the concurrent-approval test proves exactly one successful transition and one audit record;
- the example compiles without warnings;
- generated output is deterministic;
- the demo shows permitted and rejected behaviors correctly;
- no generated SQL or TypeScript action input accepts a caller-supplied principal ID;
- an authenticated session is bound to the correct model principal through `session_user`;
- direct application-role mutation is denied by PostgreSQL;
- the owner role is `NOLOGIN` and application roles cannot assume it;
- every source rule and compiler-derived identity or lock mechanism appears in `enforcement.md`;
- every source rule has a concrete generated enforcement object;
- unsupported language constructs fail compilation;
- the README documents the security guarantee and operational assumptions precisely;
- the README can be followed from a clean checkout;
- there are no placeholder implementations in the compiler's successful path.

## 21. Recommended implementation order

1. Define TypeScript AST and IR types, including principal metadata, expression nullability, and lock plans.
2. Hand-author the expected IR for the procurement example.
3. Implement PostgreSQL entity and constraint generation from the hand-authored IR.
4. Implement owner/application roles, internal principal binding, `session_user` resolution, and action-only privileges.
5. Implement generated action functions with canonical row locking and fail-closed guard evaluation.
6. Prove identity binding, privilege separation, stale-read prevention, and concurrent transition behavior with real PostgreSQL integration tests.
7. Implement TypeScript client generation from the same IR, omitting principal inputs.
8. Implement Mermaid and enforcement explanation generation.
9. Implement lexer and parser.
10. Implement resolution, nullability-aware type checking, principal validation, and lock-dependency analysis.
11. Implement AST-to-IR lowering.
12. Connect the CLI and replace the hand-authored IR fixture with compiled output.
13. Add negative compiler tests and deterministic-output tests.
14. Finish the demo and README.

This order tests the central thesis and its security boundary before spending effort on language ergonomics.

## 22. Instructions to the implementation agent

Build the repository described in this specification. Make reasonable local choices only where the specification is silent. Preserve the scope boundaries. Prefer simple, explicit code over framework-heavy abstractions.

During implementation:

- keep the AST, semantic model, IR, and backend representations distinct;
- add tests with each compiler stage;
- do not let code generators consume raw source text;
- do not add arbitrary embedded TypeScript or SQL to the language;
- do not silently ignore unsupported constructs;
- do not substitute an in-memory fake for PostgreSQL integration tests;
- do not expose a generic update method in the generated client;
- do not expose or accept a caller-supplied actor/principal UUID;
- use `session_user`, not `current_user`, for principal binding inside privileged functions;
- do not evaluate guards from records loaded before their required locks;
- implement the race tests with transaction barriers and observed PostgreSQL lock waiting, not sleep-only timing;
- do not treat generated graphs or explanations as hand-maintained files;
- commit the procurement example and expected generated fixtures;
- document that text-plus-`CHECK` enums, the limited expression language, and per-user demo database logins are deliberate PoC tradeoffs;
- leave the repository in a state where the documented commands execute successfully.

When a design choice would weaken the guarantee that model rules are enforced, choose the stricter fail-closed design and document the choice.

## 23. Expected proof at the end

The final demonstration should make this chain visible:

```text
Ontology declaration, including authenticated caller semantics
        ↓
Typed canonical IR with nullability and lock plan
        ↓
Authenticated PostgreSQL session
        ↓
session_user -> owner-controlled model-principal binding
        ↓
Enforcement classification
        ↓
PostgreSQL constraints + deterministic row locks
+ guarded action functions + restricted privileges
        ↓
Generated TypeScript action-only client with no actor argument
        ↓
Permitted behavior succeeds; impersonation, stale authorization,
direct mutation, and invalid transitions fail
```

That is the proof of concept: not that the ontology describes the application, but that the ontology produces the authenticated, concurrency-safe mechanisms through which the application is allowed to change state.

## 24. Deliberate proof-of-concept tradeoffs and next boundaries

These decisions are intentional and must be called out in the README so future contributors do not mistake them for oversights:

- **Enums:** text plus named `CHECK` constraints favors deterministic DDL and explicit migration control over PostgreSQL enum type identity.
- **Expressions:** literal comparisons are sufficient to prove enforcement. Arithmetic, tax-inclusive totals, currency, rounding, string operations, aggregates, and computed fields are the next semantic boundary and would require explicit rules for precision, null propagation, and cross-backend equivalence.
- **Identity adapter:** one database login per demo caller gives the strongest self-contained proof that identity cannot be forged by passing an arbitrary UUID. A production deployment may use a trusted gateway, signed assertion, or another adapter, but it must preserve the same non-forgeable binding property.
- **Concurrency:** the generated lock planner is sound for the finite, statically identifiable entity-row dependencies supported by this language. Collection predicates, aggregates, traversals, absence checks, and phantom-sensitive rules require a stronger isolation and predicate-locking design.
- **Authority:** PostgreSQL owners, migration roles, and superusers remain able to bypass generated enforcement by design. The guarantee applies to provisioned application principals operating without elevated credentials.

Any extension beyond these boundaries must add explicit semantics, enforcement lowering, explanation output, and integration tests before it is considered supported.
