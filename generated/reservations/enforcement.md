# Reservations enforcement map

Source hash: `sha256:12cb8d05abda4323a27b8dc9ccf8eaad692e95e651b05fb4f094d1a00261c509`

| Rule or mechanism | Purpose | Layer | Generated enforcement | Source |
|---|---|---|---|---|
| `boundary:principal_binding` | Bind session_user to the model principal through an owner-controlled table. | PostgreSQL session identity | `postgres/002_schema.sql`: `model_reservations_internal.principal_binding` | compiler-derived |
| `boundary:owner_role` | Generated objects are owned by a non-login role that application principals cannot assume. | PostgreSQL role | `postgres/001_roles.sql`: `modellang_owner NOLOGIN` | compiler-derived |
| `boundary:internal_schema` | Application principals cannot access principal bindings or audit storage. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations_internal` | compiler-derived |
| `required:User.id` | id is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.user.id NOT NULL` | examples/reservations.model:4:3 |
| `annotation:User.id.id` | Enforce @id. | PostgreSQL primary key | `postgres/002_schema.sql`: `user_pkey` | examples/reservations.model:4:3 |
| `required:User.name` | name is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.user.name NOT NULL` | examples/reservations.model:5:3 |
| `boundary:User.direct_write` | Application principals cannot directly mutate entity rows. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.user` | examples/reservations.model:3:1 |
| `boundary:User.direct_read` | Application principals cannot directly read entity rows outside generated queries. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.user` | examples/reservations.model:3:1 |
| `required:Resource.id` | id is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.resource.id NOT NULL` | examples/reservations.model:9:3 |
| `annotation:Resource.id.id` | Enforce @id. | PostgreSQL primary key | `postgres/002_schema.sql`: `resource_pkey` | examples/reservations.model:9:3 |
| `required:Resource.name` | name is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.resource.name NOT NULL` | examples/reservations.model:10:3 |
| `annotation:Resource.name.unique` | Enforce @unique. | PostgreSQL constraint | `postgres/002_schema.sql`: `uq_resource_name_unique` | examples/reservations.model:10:3 |
| `boundary:Resource.direct_write` | Application principals cannot directly mutate entity rows. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.resource` | examples/reservations.model:8:1 |
| `boundary:Resource.direct_read` | Application principals cannot directly read entity rows outside generated queries. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.resource` | examples/reservations.model:8:1 |
| `required:Reservation.id` | id is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.reservation.id NOT NULL` | examples/reservations.model:14:3 |
| `annotation:Reservation.id.id` | Enforce @id. | PostgreSQL primary key | `postgres/002_schema.sql`: `reservation_pkey` | examples/reservations.model:14:3 |
| `required:Reservation.resource` | resource is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.reservation.resource_id NOT NULL` | examples/reservations.model:15:3 |
| `reference:Reservation.resource` | resource references Resource. | PostgreSQL foreign key | `postgres/002_schema.sql`: `fk_reservation_resource_id` | examples/reservations.model:15:3 |
| `required:Reservation.reservedBy` | reservedBy is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.reservation.reserved_by_id NOT NULL` | examples/reservations.model:16:3 |
| `reference:Reservation.reservedBy` | reservedBy references User. | PostgreSQL foreign key | `postgres/002_schema.sql`: `fk_reservation_reserved_by_id` | examples/reservations.model:16:3 |
| `required:Reservation.startsAt` | startsAt is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.reservation.starts_at NOT NULL` | examples/reservations.model:17:3 |
| `required:Reservation.endsAt` | endsAt is required. | PostgreSQL constraint | `postgres/002_schema.sql`: `model_reservations.reservation.ends_at NOT NULL` | examples/reservations.model:18:3 |
| `exclusion:Reservation.no_overlapping_reservations` | noOverlap(resource, startsAt, endsAt) rejects overlapping half-open intervals for the same key. | PostgreSQL exclusion constraint | `postgres/002_schema.sql`: `ex_reservation_no_overlapping_reservations` | examples/reservations.model:20:3 |
| `derived:exclusion:Reservation.no_overlapping_reservations.valid_interval` | Require interval start to be strictly before interval end. | PostgreSQL check constraint | `postgres/002_schema.sql`: `ck_reservation_no_overlapping_reservations_valid_interval` | examples/reservations.model:20:3 |
| `boundary:Reservation.direct_write` | Application principals cannot directly mutate entity rows. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.reservation` | examples/reservations.model:13:1 |
| `boundary:Reservation.direct_read` | Application principals cannot directly read entity rows outside generated queries. | PostgreSQL privilege | `postgres/004_grants.sql`: `model_reservations.reservation` | examples/reservations.model:13:1 |
| `caller:reserve.actor` | Derive the semantic caller from session_user; no caller UUID is accepted. | PostgreSQL session identity | `postgres/003_actions.sql`: `model_reservations.reserve` | examples/reservations.model:25:3 |
| `boundary:reserve.safe_search_path` | Prevent caller-controlled object shadowing inside the privileged function. | PostgreSQL function configuration | `postgres/003_actions.sql`: `model_reservations.reserve search_path=pg_catalog,pg_temp` | compiler-derived |
| `authorize:reserve` | true | PostgreSQL action guard | `postgres/003_actions.sql`: `model_reservations.reserve` | examples/reservations.model:31:13 |
| `require:reserve.valid_interval` | (startsAt < endsAt) | PostgreSQL action guard | `postgres/003_actions.sql`: `model_reservations.reserve` | examples/reservations.model:32:3 |
| `effect:reserve` | create entity:Reservation. | PostgreSQL action function | `postgres/003_actions.sql`: `model_reservations.reserve` | examples/reservations.model:24:1 |
| `lock:reserve.resource` | Stabilize parameter:reserve.resource before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR SHARE in model_reservations.reserve` | compiler-derived |
| `lock:reserve.actor` | Stabilize caller before evaluating guards and effects. | PostgreSQL row lock | `postgres/003_actions.sql`: `FOR SHARE in model_reservations.reserve` | compiler-derived |
| `caller:reservationsForResource.actor` | Derive the semantic caller from session_user; no caller UUID is accepted. | PostgreSQL session identity | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:44:3 |
| `boundary:reservationsForResource.safe_search_path` | Prevent caller-controlled object shadowing inside the privileged function. | PostgreSQL function configuration | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource search_path=pg_catalog,pg_temp` | compiler-derived |
| `authorize:reservationsForResource` | true | PostgreSQL query guard | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:47:13 |
| `where:reservationsForResource` | (reservation.resource == resource) | PostgreSQL row policy | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:48:9 |
| `order:reservationsForResource` | Return rows in the declared order with an ascending identity tie-breaker. | PostgreSQL query function | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:43:1 |
| `limit:reservationsForResource` | Return at most 100 rows. | PostgreSQL query function | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:43:1 |
| `read:reservationsForResource` | Read entity:Reservation through the generated query boundary. | PostgreSQL query function | `postgres/003_queries.sql`: `model_reservations.reservations_for_resource` | examples/reservations.model:43:1 |
| `boundary:audit` | Record each successful action with database and model principal identities. | PostgreSQL audit | `postgres/003_actions.sql`: `model_reservations_internal.action_audit` | compiler-derived |
