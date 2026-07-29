-- source sha256:24fd2868fa8917ac17c9a9ca5b1f8e200a35defb3c2670c95d1bad8ad04377aa
CREATE SCHEMA "model_procurement" AUTHORIZATION modellang_owner;
CREATE SCHEMA "model_procurement_internal" AUTHORIZATION modellang_owner;
SET ROLE modellang_owner;
REVOKE ALL ON SCHEMA "model_procurement" FROM PUBLIC;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC;

CREATE TABLE "model_procurement"."user" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "role" text NOT NULL,
  CONSTRAINT "ck_user_role_enum" CHECK (("role" IN ('EMPLOYEE', 'MANAGER', 'FINANCE')) IS TRUE)
);

CREATE TABLE "model_procurement"."purchase_request" (
  "id" uuid NOT NULL PRIMARY KEY,
  "requester_id" uuid NOT NULL,
  "amount" numeric NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid,
  "approved_by_role" text,
  CONSTRAINT "ck_purchase_request_amount_min_exclusive" CHECK (("amount" > 0) IS TRUE),
  CONSTRAINT "ck_purchase_request_status_enum" CHECK (("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED')) IS TRUE),
  CONSTRAINT "ck_purchase_request_approved_by_role_enum" CHECK ((("approved_by_role" IS NULL OR "approved_by_role" IN ('EMPLOYEE', 'MANAGER', 'FINANCE'))) IS TRUE),
  CONSTRAINT "ck_purchase_request_approval_fields_match_status" CHECK (((((("status" = 'APPROVED') AND ("approved_by_id" IS NOT NULL)) AND ("approved_by_role" IS NOT NULL)) OR ((("status" <> 'APPROVED') AND ("approved_by_id" IS NULL)) AND ("approved_by_role" IS NULL)))) IS TRUE)
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

