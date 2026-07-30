-- source sha256:da275901eb5fd98551ce71b83a0bc11e4e02e97e0381348defe5d3a231571b68
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
  "id" uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "requester_id" uuid NOT NULL,
  "amount" numeric NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_by_id" uuid,
  "approved_by_roles" text[],
  CONSTRAINT "ck_purchase_request_amount_money" CHECK (("amount" <> 'NaN'::numeric AND pg_catalog.scale("amount") <= 2 AND pg_catalog.abs("amount") < 1000000000000000000) IS TRUE),
  CONSTRAINT "ck_purchase_request_amount_min_exclusive" CHECK (("amount" > 0) IS TRUE),
  CONSTRAINT "ck_purchase_request_status_enum" CHECK (("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED')) IS TRUE),
  CONSTRAINT "ck_purchase_request_approved_by_roles_enum_set" CHECK (("approved_by_roles" IS NULL OR ("approved_by_roles" <@ ARRAY['EMPLOYEE', 'MANAGER', 'FINANCE']::text[] AND pg_catalog.array_position("approved_by_roles", NULL::text) IS NULL AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'EMPLOYEE')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'MANAGER')) <= 1 AND pg_catalog.cardinality(pg_catalog.array_positions("approved_by_roles", 'FINANCE')) <= 1)) IS TRUE),
  CONSTRAINT "ck_purchase_request_approval_fields_match_status" CHECK (((((("status" = 'APPROVED') AND ("approved_by_id" IS NOT NULL)) AND ("approved_by_roles" IS NOT NULL)) OR ((("status" <> 'APPROVED') AND ("approved_by_id" IS NULL)) AND ("approved_by_roles" IS NULL)))) IS TRUE),
  CONSTRAINT "ck_purchase_request_approval_authority_matches_amount" CHECK (((("status" <> 'APPROVED') OR ((("amount" <= 10000) AND ('MANAGER' = ANY("approved_by_roles"))) OR (("amount" > 10000) AND ('FINANCE' = ANY("approved_by_roles")))))) IS TRUE),
  CONSTRAINT "ck_purchase_request_approver_differs_from_requester" CHECK (((("status" <> 'APPROVED') OR ("approved_by_id" <> "requester_id"))) IS TRUE)
);

ALTER TABLE "model_procurement"."purchase_request"
  ADD CONSTRAINT "fk_purchase_request_requester_id"
  FOREIGN KEY ("requester_id") REFERENCES "model_procurement"."user" ("id");

ALTER TABLE "model_procurement"."purchase_request"
  ADD CONSTRAINT "fk_purchase_request_approved_by_id"
  FOREIGN KEY ("approved_by_id") REFERENCES "model_procurement"."user" ("id");

CREATE FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $modellang$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ML_WORKFLOW:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87', CONSTRAINT = 'trg_purchase_request_status_workflow_insert';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED')
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" = 'APPROVED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ML_WORKFLOW:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87', CONSTRAINT = 'trg_purchase_request_status_workflow_update';
  END IF;
  RETURN NEW;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"() FROM PUBLIC;
CREATE TRIGGER "trg_purchase_request_status_workflow_insert"
AFTER INSERT ON "model_procurement"."purchase_request"
FOR EACH ROW EXECUTE FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"();
CREATE TRIGGER "trg_purchase_request_status_workflow_update"
BEFORE UPDATE OF "status" ON "model_procurement"."purchase_request"
FOR EACH ROW EXECUTE FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"();

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

