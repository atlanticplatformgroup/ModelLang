-- source sha256:ad8de99d704f929bed89e7e29107bf61412f48faf514104286b917b1e55a1415
CREATE SCHEMA "model_procurement" AUTHORIZATION modellang_owner;
CREATE SCHEMA "model_procurement_internal" AUTHORIZATION modellang_owner;
SET ROLE modellang_owner;
REVOKE ALL ON SCHEMA "model_procurement" FROM PUBLIC;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC;

CREATE TABLE "model_procurement"."user" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "roles" text[] NOT NULL,
  CONSTRAINT "ck_user_roles_enum_set" CHECK (("roles" <@ ARRAY['EMPLOYEE', 'MANAGER', 'FINANCE']::text[] AND pg_catalog.array_position("roles", NULL::text) IS NULL AND pg_catalog.cardinality(pg_catalog.array_positions("roles", 'EMPLOYEE')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("roles", 'MANAGER')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("roles", 'FINANCE')) <= 1) IS TRUE)
);

CREATE TABLE "model_procurement"."purchase_request" (
  "id" uuid NOT NULL PRIMARY KEY,
  "requester_id" uuid NOT NULL,
  "amount" numeric NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid,
  "approved_by_roles" text[],
  CONSTRAINT "ck_purchase_request_amount_min_exclusive" CHECK (("amount" > 0) IS TRUE),
  CONSTRAINT "ck_purchase_request_status_enum" CHECK (("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED')) IS TRUE),
  CONSTRAINT "ck_purchase_request_approved_by_roles_enum_set" CHECK (("approved_by_roles" IS NULL OR ("approved_by_roles" <@ ARRAY['EMPLOYEE', 'MANAGER', 'FINANCE']::text[] AND pg_catalog.array_position("approved_by_roles", NULL::text) IS NULL AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'EMPLOYEE')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'MANAGER')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'FINANCE')) <= 1)) IS TRUE),
  CONSTRAINT "ck_purchase_request_approval_fields_match_status" CHECK (((((("status" = 'APPROVED') AND ("approved_by_id" IS NOT NULL)) AND ("approved_by_roles" IS NOT NULL)) OR ((("status" <> 'APPROVED') AND ("approved_by_id" IS NULL)) AND ("approved_by_roles" IS NULL)))) IS TRUE)
);

ALTER TABLE "model_procurement"."purchase_request"
  ADD CONSTRAINT "fk_purchase_request_requester_id"
  FOREIGN KEY ("requester_id") REFERENCES "model_procurement"."user" ("id");

ALTER TABLE "model_procurement"."purchase_request"
  ADD CONSTRAINT "fk_purchase_request_approved_by_id"
  FOREIGN KEY ("approved_by_id") REFERENCES "model_procurement"."user" ("id");

CREATE TABLE "model_procurement_internal"."principal_binding" (
  "database_principal" name PRIMARY KEY,
  "principal_id" uuid NOT NULL UNIQUE REFERENCES "model_procurement"."user" ("id")
);

CREATE TABLE "model_procurement_internal"."action_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "action_id" text NOT NULL,
  "database_principal" name NOT NULL,
  "principal_id" uuid NOT NULL,
  "target_id" uuid,
  "occurred_at" timestamptz NOT NULL DEFAULT transaction_timestamp()
);
RESET ROLE;

