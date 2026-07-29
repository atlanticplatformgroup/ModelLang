# Procurement enforcement map

Source hash: `sha256:24fd2868fa8917ac17c9a9ca5b1f8e200a35defb3c2670c95d1bad8ad04377aa`

| Rule or mechanism | Purpose | Layer | Generated enforcement | Source |
|---|---|---|---|---|
| `boundary:principal_binding` | Bind session_user to the model principal through an owner-controlled table. | PostgreSQL session identity | `postgres/002_schema.sql`: `model_procurement_internal.principal_binding` | compiler-derived |
| `boundary:owner_role` | Generated objects are owned by a non-login role that application principals cannot assume. | PostgreSQL role | `postgres/001_roles.sql`: `modellang_owner NOLOGIN` | compiler-derived |
| `boundary:internal_schema` | Application principals cannot access principal bindings or audit storage. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_procurement_internal` | compiler-derived |
| `required:User.id` | id is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.user.id NOT NULL` | examples/procurement.model:16:3 |
| `annotation:User.id.id` | Enforce @id. | PostgreSQL primary key | `postgres/002_schema.sql`: `user_pkey` | examples/procurement.model:16:3 |
| `required:User.name` | name is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.user.name NOT NULL` | examples/procurement.model:17:3 |
| `required:User.role` | role is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.user.role NOT NULL` | examples/procurement.model:18:3 |
| `enum-membership:User.role` | role must be a declared Role member. | PostgreSQL constraint | `postgres/002_schema.sql`: `ck_user_role_enum` | examples/procurement.model:18:3 |
| `boundary:User.direct_write` | Application principals cannot directly mutate entity rows. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_procurement.user` | examples/procurement.model:15:1 |
| `required:PurchaseRequest.id` | id is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.purchase_request.id NOT NULL` | examples/procurement.model:22:3 |
| `annotation:PurchaseRequest.id.id` | Enforce @id. | PostgreSQL primary key | `postgres/002_schema.sql`: `purchase_request_pkey` | examples/procurement.model:22:3 |
| `required:PurchaseRequest.requester` | requester is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.purchase_request.requester_id NOT NULL` | examples/procurement.model:23:3 |
| `reference:PurchaseRequest.requester` | requester references User. | PostgreSQL foreign key | `postgres/002_schema.sql`: `fk_purchase_request_requester_id` | examples/procurement.model:23:3 |
| `required:PurchaseRequest.amount` | amount is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.purchase_request.amount NOT NULL` | examples/procurement.model:24:3 |
| `annotation:PurchaseRequest.amount.minExclusive` | Enforce @minExclusive(0). | PostgreSQL constraint | `postgres/002_schema.sql`: `ck_purchase_request_amount_min_exclusive` | examples/procurement.model:24:3 |
| `required:PurchaseRequest.status` | status is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_procurement.purchase_request.status NOT NULL` | examples/procurement.model:25:3 |
| `enum-membership:PurchaseRequest.status` | status must be a declared RequestStatus member. | PostgreSQL constraint | `postgres/002_schema.sql`: `ck_purchase_request_status_enum` | examples/procurement.model:25:3 |
| `default:PurchaseRequest.status` | Apply the declared constant default for status. | PostgreSQL column default | `postgres/002_schema.sql`: `model_procurement.purchase_request.status` | examples/procurement.model:25:3 |
| `reference:PurchaseRequest.approvedBy` | approvedBy references User. | PostgreSQL foreign key | `postgres/002_schema.sql`: `fk_purchase_request_approved_by_id` | examples/procurement.model:26:3 |
| `enum-membership:PurchaseRequest.approvedByRole` | approvedByRole must be a declared Role member. | PostgreSQL constraint | `postgres/002_schema.sql`: `ck_purchase_request_approved_by_role_enum` | examples/procurement.model:27:3 |
| `snapshot:PurchaseRequest.approvedByRole` | approvedByRole is a stored point-in-time audit snapshot, not a live relationship-derived value. | ModelLang storage semantics | `model.ir.json`: `field:PurchaseRequest.approvedByRole` | examples/procurement.model:27:3 |
| `invariant:PurchaseRequest.approval_fields_match_status` | ((((status == RequestStatus.APPROVED) and (approvedBy != null)) and (approvedByRole != null)) or (((status != RequestStatus.APPROVED) and (approvedBy == null)) and (approvedByRole == null))) | PostgreSQL constraint | `postgres/002_schema.sql`: `ck_purchase_request_approval_fields_match_status` | examples/procurement.model:29:3 |
| `boundary:PurchaseRequest.direct_write` | Application principals cannot directly mutate entity rows. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_procurement.purchase_request` | examples/procurement.model:21:1 |
| `caller:openRequest.actor` | Derive the semantic caller from session_user; no caller UUID is accepted. | PostgreSQL session identity | `postgres/003_actions.sql`: `model_procurement.open_request` | examples/procurement.model:46:3 |
| `boundary:openRequest.safe_search_path` | Prevent caller-controlled object shadowing inside the privileged function. | PostgreSQL function configuration | `postgres/003_actions.sql`: `model_procurement.open_request search_path=pg_catalog,pg_temp` | compiler-derived |
| `authorize:openRequest` | (actor.role == Role.EMPLOYEE) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.open_request` | examples/procurement.model:50:13 |
| `require:openRequest.positive_amount` | (amount > 0) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.open_request` | examples/procurement.model:51:3 |
| `effect:openRequest` | create entity:PurchaseRequest. | PostgreSQL action function | `postgres/003_actions.sql`: `model_procurement.open_request` | examples/procurement.model:45:1 |
| `lock:openRequest.actor` | Stabilize caller before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR SHARE in model_procurement.open_request` | compiler-derived |
| `caller:submitRequest.actor` | Derive the semantic caller from session_user; no caller UUID is accepted. | PostgreSQL session identity | `postgres/003_actions.sql`: `model_procurement.submit_request` | examples/procurement.model:64:3 |
| `boundary:submitRequest.safe_search_path` | Prevent caller-controlled object shadowing inside the privileged function. | PostgreSQL function configuration | `postgres/003_actions.sql`: `model_procurement.submit_request search_path=pg_catalog,pg_temp` | compiler-derived |
| `authorize:submitRequest` | (actor == request.requester) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.submit_request` | examples/procurement.model:67:13 |
| `require:submitRequest.is_draft` | (request.status == RequestStatus.DRAFT) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.submit_request` | examples/procurement.model:68:3 |
| `effect:submitRequest` | update entity:PurchaseRequest. | PostgreSQL action function | `postgres/003_actions.sql`: `model_procurement.submit_request` | examples/procurement.model:63:1 |
| `lock:submitRequest.request` | Stabilize parameter:submitRequest.request before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR UPDATE in model_procurement.submit_request` | compiler-derived |
| `lock:submitRequest.actor` | Stabilize caller before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR SHARE in model_procurement.submit_request` | compiler-derived |
| `caller:approveRequest.actor` | Derive the semantic caller from session_user; no caller UUID is accepted. | PostgreSQL session identity | `postgres/003_actions.sql`: `model_procurement.approve_request` | examples/procurement.model:76:3 |
| `boundary:approveRequest.safe_search_path` | Prevent caller-controlled object shadowing inside the privileged function. | PostgreSQL function configuration | `postgres/003_actions.sql`: `model_procurement.approve_request search_path=pg_catalog,pg_temp` | compiler-derived |
| `authorize:approveRequest` | (((request.amount <= 10000) and (actor.role == Role.MANAGER)) or ((request.amount > 10000) and (actor.role == Role.FINANCE))) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.approve_request` | examples/procurement.model:80:6 |
| `require:approveRequest.is_submitted` | (request.status == RequestStatus.SUBMITTED) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_procurement.approve_request` | examples/procurement.model:84:3 |
| `effect:approveRequest` | update entity:PurchaseRequest. | PostgreSQL action function | `postgres/003_actions.sql`: `model_procurement.approve_request` | examples/procurement.model:75:1 |
| `lock:approveRequest.request` | Stabilize parameter:approveRequest.request before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR UPDATE in model_procurement.approve_request` | compiler-derived |
| `lock:approveRequest.actor` | Stabilize caller before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR SHARE in model_procurement.approve_request` | compiler-derived |
| `boundary:audit` | Record each successful action with database and model principal identities. | PostgreSQL audit | `postgres/003_actions.sql`: `model_procurement_internal.action_audit` | compiler-derived |
