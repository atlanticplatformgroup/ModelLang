-- source sha256:0a9c4bc4ebf0fc2c92472b586ce11a09dae23b02a5870678a20bd1caa88851ad
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

CREATE OR REPLACE FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"()
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

CREATE TABLE IF NOT EXISTS "model_procurement_internal"."gateway_principal_binding" (
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "principal_id" uuid NOT NULL REFERENCES "model_procurement"."user" ("id"),
  PRIMARY KEY ("issuer", "subject"),
  CONSTRAINT "ck_gateway_principal_binding_identity" CHECK (
    pg_catalog.char_length("issuer") BETWEEN 1 AND 512
    AND pg_catalog.char_length("subject") BETWEEN 1 AND 512
  )
);
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_issuer" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_subject" text;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_gateway_identity'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_gateway_identity"
      CHECK (("identity_issuer" IS NULL) = ("identity_subject" IS NULL));
  END IF;
END
$modellang$;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."bind_gateway_identity"(p_issuer text, p_subject text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_GATEWAY_REQUIRED';
  END IF;
  IF p_issuer IS NULL OR pg_catalog.char_length(p_issuer) NOT BETWEEN 1 AND 512
     OR p_subject IS NULL OR pg_catalog.char_length(p_subject) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:gateway_identity';
  END IF;
  PERFORM 1 FROM "model_procurement_internal"."gateway_principal_binding" AS binding
  WHERE binding."issuer" = p_issuer AND binding."subject" = p_subject
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
  PERFORM pg_catalog.set_config('modellang.gateway_issuer', p_issuer, true);
  PERFORM pg_catalog.set_config('modellang.gateway_subject', p_subject, true);
END
$modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."resolve_principal"()
RETURNS TABLE ("principal_id" uuid, "identity_issuer" text, "identity_subject" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_issuer text;
  v_subject text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);
    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);
    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
    END IF;
    RETURN QUERY
      SELECT binding."principal_id", binding."issuer", binding."subject"
      FROM "model_procurement_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject
      FOR SHARE;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id", NULL::text, NULL::text
      FROM "model_procurement_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user
      FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."resolve_principal"() FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."resolve_principal_snapshot"()
RETURNS TABLE ("principal_id" uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_issuer text;
  v_subject text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);
    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);
    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
    END IF;
    RETURN QUERY
      SELECT binding."principal_id"
      FROM "model_procurement_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id"
      FROM "model_procurement_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."resolve_principal_snapshot"() FROM PUBLIC;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_version" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "source_hash" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authorization_rule_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_outcome" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "policy_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authority_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_evidence" jsonb;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_decision_evidence'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_decision_evidence" CHECK (
      ("decision_evidence" IS NULL
       AND "model_id" IS NULL AND "model_version" IS NULL
       AND "source_hash" IS NULL AND "authorization_rule_id" IS NULL
       AND "decision_outcome" IS NULL AND "policy_id" IS NULL AND "authority_id" IS NULL)
      OR
      ("decision_evidence" IS NOT NULL
       AND "model_id" IS NOT NULL AND "model_version" IS NOT NULL
       AND "source_hash" ~ '^sha256:[0-9a-f]{64}$'
       AND "authorization_rule_id" IS NOT NULL AND "decision_outcome" = 'executed'
       AND (("policy_id" IS NULL) = ("authority_id" IS NULL)))
    );
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."command_receipt" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "action_id" text NOT NULL,
  "principal_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "status" text NOT NULL DEFAULT 'executing',
  "response" jsonb,
  "target_id" uuid,
  "action_audit_id" bigint UNIQUE REFERENCES "model_procurement_internal"."action_audit" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "completed_at" timestamptz,
  CONSTRAINT "uq_command_receipt_identity" UNIQUE ("principal_id", "action_id", "idempotency_key"),
  CONSTRAINT "ck_command_receipt_hashes" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$' AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_command_receipt_ids" CHECK ("idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND "correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_command_receipt_completion" CHECK (
    ("status" = 'executing' AND "response" IS NULL AND "target_id" IS NULL AND "action_audit_id" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'executed' AND "response" IS NOT NULL AND "target_id" IS NOT NULL AND "action_audit_id" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "correlation_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "causation_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "command_receipt_id" bigint;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_action_audit_command_receipt" ON "model_procurement_internal"."action_audit" ("command_receipt_id") WHERE "command_receipt_id" IS NOT NULL;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass AND conname = 'fk_action_audit_command_receipt'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "fk_action_audit_command_receipt" FOREIGN KEY ("command_receipt_id") REFERENCES "model_procurement_internal"."command_receipt" ("id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass AND conname = 'ck_action_audit_command_metadata'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_command_metadata" CHECK (
      ("correlation_id" IS NULL AND "causation_id" IS NULL AND "command_receipt_id" IS NULL)
      OR ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))
    );
  END IF;
END
$modellang$;

CREATE TABLE "model_procurement_internal"."schema_migrations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_id" text NOT NULL,
  "version" text NOT NULL UNIQUE,
  "source_hash" text NOT NULL UNIQUE,
  "migration_kind" text NOT NULL,
  "plan_hash" text,
  CONSTRAINT "ck_schema_migrations_kind" CHECK ("migration_kind" IN ('installation', 'safe', 'reviewed')),
  CONSTRAINT "ck_schema_migrations_reviewed_plan" CHECK (
    (("migration_kind" = 'reviewed') = ("plan_hash" IS NOT NULL))
    AND ("plan_hash" IS NULL OR "plan_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  "applied_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
INSERT INTO "model_procurement_internal"."schema_migrations" ("model_id", "version", "source_hash", "migration_kind")
VALUES ('model:Procurement', '0.12.0', 'sha256:0a9c4bc4ebf0fc2c92472b586ce11a09dae23b02a5870678a20bd1caa88851ad', 'installation');
RESET ROLE;

