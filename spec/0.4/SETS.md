# ModelLang 0.4 — Enum Sets and Membership

Status: normative design contract for the 0.4 reference compiler.

## Purpose

A single enum-valued role field makes roles mutually exclusive. ModelLang 0.4 adds stored enum sets so one principal can hold several roles or permissions without bypassing generated authorization.

## Surface form

```modellang
enum Role {
  EMPLOYEE,
  MANAGER,
  FINANCE
}

entity User {
  id: UUID @id;
  roles: Set<Role>;
}

action openRequest(caller actor: User, id: UUID, amount: Decimal) -> PurchaseRequest {
  authorize Role.EMPLOYEE in actor.roles;
  // ...
}
```

`Set<T>` is valid only when `T` is a declared enum and only as a stored entity-field type in 0.4. Set-valued action/query parameters, set literals, and set defaults are unsupported.

Fields may be optional (`Set<Role>?`). A required set may be empty. Enum-set fields may use `@snapshot`; other field annotations are unsupported on sets in 0.4.

## Set values

An enum set is unordered and contains each enum member at most once. It cannot contain null or an undeclared enum member.

Set equality and ordering are undefined in 0.4. The only set operation is membership:

```modellang
Role.MANAGER in actor.roles
```

The left operand must be a member of the same enum as the right-hand set. Membership returns Boolean, or nullable Boolean when the set or member expression is nullable. Authorization, preconditions, query filters, and invariants continue to require exactly true, so membership against a null optional set fails closed.

## Snapshot semantics

An enum set marked `@snapshot` is stored point-in-time data. An action must explicitly assign `null` or a direct compatible set-valued field. The entire set is copied. Later changes to the source set do not propagate.

The compiler never infers which role authorized an action. If a model snapshots all caller roles, that records the caller’s complete role context at that moment, not a single causal role.

## PostgreSQL representation

Enum sets compile to `text[]`. Generated check constraints enforce:

- every element is a declared enum member;
- no element is null;
- no member appears more than once.

Membership compiles to PostgreSQL array membership. The TypeScript representation is an array of the generated enum union.

## 0.4 non-goals

- sets of scalars or entities;
- set-valued parameters or return values;
- set literals or defaults;
- set equality, ordering, union, intersection, or difference;
- adding/removing individual members in an action;
- computed, inherited, or database-derived permissions;
- permission implication or role hierarchy;
- field-level read authorization.
