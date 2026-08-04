-- source sha256:a4a1c2c6f15a13da6049c57ef6d27ae86de48de2282303fe845c3d5b54e64a77
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
  "approval_observed" boolean NOT NULL DEFAULT FALSE,
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
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."query_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "query_id" text NOT NULL,
  "database_principal" name NOT NULL,
  "principal_id" uuid NOT NULL,
  "identity_issuer" text,
  "identity_subject" text,
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "query_revision" text NOT NULL,
  "request_hash" text NOT NULL,
  "response_hash" text NOT NULL,
  "result_count" integer NOT NULL,
  "sort_profile" text NOT NULL,
  "continued" boolean NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT "ck_query_audit_identity" CHECK (("identity_issuer" IS NULL) = ("identity_subject" IS NULL)),
  CONSTRAINT "ck_query_audit_source_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_query_audit_revision" CHECK ("query_revision" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_query_audit_request_hash" CHECK ("request_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_query_audit_response_hash" CHECK ("response_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_query_audit_result_count" CHECK ("result_count" >= 0)
);
CREATE INDEX IF NOT EXISTS "ix_query_audit_query_principal_time" ON "model_procurement_internal"."query_audit" ("query_id", "principal_id", "occurred_at", "id");
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
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "consumer_id" text NOT NULL,
  "source_event_id" uuid NOT NULL,
  "source_event_type" text NOT NULL,
  "source_model_id" text NOT NULL,
  "source_model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "target_id" uuid,
  "decision_outcome" text NOT NULL DEFAULT 'executed',
  "authorization_rule_id" text NOT NULL,
  "policy_id" text,
  "authority_id" text,
  "decision_evidence" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT "uq_consumer_audit_event" UNIQUE ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_audit_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_consumer_audit_metadata" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))
);
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_inbox" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "consumer_id" text NOT NULL,
  "source_event_id" uuid NOT NULL,
  "source_event_type" text NOT NULL,
  "source_event_name" text NOT NULL,
  "source_model_id" text NOT NULL,
  "source_model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "envelope_hash" text NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "first_delivery_attempt" integer NOT NULL,
  "last_delivery_attempt" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'claimed',
  "target_id" uuid,
  "response" jsonb,
  "consumer_audit_id" bigint REFERENCES "model_procurement_internal"."consumer_audit" ("id"),
  "claimed_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "completed_at" timestamptz,
  CONSTRAINT "uq_event_inbox_identity" UNIQUE ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_event_inbox_hashes" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$' AND "envelope_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_inbox_attempts" CHECK ("first_delivery_attempt" >= 1 AND "last_delivery_attempt" >= "first_delivery_attempt"),
  CONSTRAINT "ck_event_inbox_status" CHECK (("status" = 'claimed' AND "response" IS NULL AND "completed_at" IS NULL AND "consumer_audit_id" IS NULL) OR ("status" = 'executed' AND "response" IS NOT NULL AND "completed_at" IS NOT NULL AND "consumer_audit_id" IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_failure" (
  "consumer_id" text NOT NULL,
  "source_event_id" text NOT NULL,
  "failure_count" integer NOT NULL DEFAULT 1,
  "total_failure_count" integer NOT NULL DEFAULT 1,
  "recovery_generation" integer NOT NULL DEFAULT 0,
  "last_delivery_attempt" integer NOT NULL,
  "last_error_code" text NOT NULL,
  "max_attempts" integer,
  "disposition" text NOT NULL DEFAULT 'retry',
  "last_failed_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  "terminal_at" timestamptz,
  "resolved_at" timestamptz,
  "last_recovered_at" timestamptz,
  PRIMARY KEY ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_failure_count" CHECK ("failure_count" >= 0 AND "total_failure_count" >= 1 AND "total_failure_count" >= "failure_count" AND "recovery_generation" >= 0 AND "last_delivery_attempt" >= 1),
  CONSTRAINT "ck_consumer_failure_code" CHECK ("last_error_code" ~ '^ML_[A-Z_]+$'),
  CONSTRAINT "ck_consumer_failure_disposition" CHECK (
    ("disposition" = 'ready' AND "failure_count" = 0 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
    OR ("disposition" = 'retry' AND "failure_count" >= 1 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
    OR ("disposition" = 'deadLetter' AND "max_attempts" IS NOT NULL AND "failure_count" >= "max_attempts" AND "terminal_at" IS NOT NULL AND "resolved_at" IS NULL)
    OR ("disposition" = 'resolved' AND "terminal_at" IS NULL AND "resolved_at" IS NOT NULL)
  )
);
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "total_failure_count" integer;
UPDATE "model_procurement_internal"."consumer_failure" SET "total_failure_count" = "failure_count" WHERE "total_failure_count" IS NULL;
ALTER TABLE "model_procurement_internal"."consumer_failure" ALTER COLUMN "total_failure_count" SET DEFAULT 1;
ALTER TABLE "model_procurement_internal"."consumer_failure" ALTER COLUMN "total_failure_count" SET NOT NULL;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "recovery_generation" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "max_attempts" integer;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "disposition" text NOT NULL DEFAULT 'retry';
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "terminal_at" timestamptz;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "last_recovered_at" timestamptz;
ALTER TABLE "model_procurement_internal"."consumer_failure" DROP CONSTRAINT IF EXISTS "ck_consumer_failure_count";
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD CONSTRAINT "ck_consumer_failure_count" CHECK ("failure_count" >= 0 AND "total_failure_count" >= 1 AND "total_failure_count" >= "failure_count" AND "recovery_generation" >= 0 AND "last_delivery_attempt" >= 1);
ALTER TABLE "model_procurement_internal"."consumer_failure" DROP CONSTRAINT IF EXISTS "ck_consumer_failure_disposition";
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD CONSTRAINT "ck_consumer_failure_disposition" CHECK (
  ("disposition" = 'ready' AND "failure_count" = 0 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'retry' AND "failure_count" >= 1 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'deadLetter' AND "max_attempts" IS NOT NULL AND "failure_count" >= "max_attempts" AND "terminal_at" IS NOT NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'resolved' AND "terminal_at" IS NULL AND "resolved_at" IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_recovery_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "consumer_id" text NOT NULL,
  "source_event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "prior_failure_count" integer NOT NULL,
  "total_failure_count" integer NOT NULL,
  "prior_error_code" text NOT NULL,
  "reason_code" text NOT NULL,
  "database_principal" name NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_consumer_recovery_generation" UNIQUE ("consumer_id", "source_event_id", "recovery_generation"),
  CONSTRAINT "fk_consumer_recovery_failure" FOREIGN KEY ("consumer_id", "source_event_id") REFERENCES "model_procurement_internal"."consumer_failure" ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_recovery_counts" CHECK ("recovery_generation" >= 1 AND "prior_failure_count" >= 1 AND "total_failure_count" >= "prior_failure_count"),
  CONSTRAINT "ck_consumer_recovery_codes" CHECK ("prior_error_code" ~ '^ML_[A-Z_]+$' AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE OR REPLACE FUNCTION "model_procurement_internal"."consumer_failure_state"(p_consumer_id text, p_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_max_attempts integer;
  v_failure_count integer;
  v_error_code text;
  v_disposition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS consumer_role ON consumer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE consumer_role.rolname = 'modellang_consumer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_REQUIRED';
  END IF;
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  p_event_id := p_event_id::uuid::text;
  v_max_attempts := CASE p_consumer_id WHEN 'consumer:con_10d694c9a0a274dc79c6168e47d25968' THEN 3 ELSE NULL END;
  SELECT "failure_count", "last_error_code", "disposition" INTO v_failure_count, v_error_code, v_disposition
  FROM "model_procurement_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition IN ('ready', 'resolved') THEN RETURN pg_catalog.jsonb_build_object('status', 'ready'); END IF;
  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;
  UPDATE "model_procurement_internal"."consumer_failure" SET "max_attempts" = v_max_attempts, "disposition" = v_disposition,
    "terminal_at" = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE("terminal_at", pg_catalog.clock_timestamp()) ELSE NULL END, "resolved_at" = (NULL::timestamptz)
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', v_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."consumer_failure_state"(text, text) FROM PUBLIC;
DROP FUNCTION IF EXISTS "model_procurement_internal"."record_consumer_failure"(text, text, integer, text);
CREATE FUNCTION "model_procurement_internal"."record_consumer_failure"(p_consumer_id text, p_event_id text, p_delivery_attempt integer, p_error_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_max_attempts integer;
  v_failure_count integer;
  v_disposition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS consumer_role ON consumer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE consumer_role.rolname = 'modellang_consumer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_REQUIRED';
  END IF;
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'
     OR p_delivery_attempt IS NULL OR p_delivery_attempt < 1 OR p_error_code IS NULL OR p_error_code !~ '^ML_[A-Z_]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  v_max_attempts := CASE p_consumer_id WHEN 'consumer:con_10d694c9a0a274dc79c6168e47d25968' THEN 3 ELSE NULL END;
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."event_inbox" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id::uuid AND "status" = 'executed') THEN
    UPDATE "model_procurement_internal"."consumer_failure" SET "disposition" = 'resolved', "max_attempts" = v_max_attempts, "terminal_at" = (NULL::timestamptz), "resolved_at" = COALESCE("resolved_at", pg_catalog.clock_timestamp())
    WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
    RETURN pg_catalog.jsonb_build_object('status', 'ignoredCommitted', 'recorded', FALSE, 'errorCode', p_error_code, 'failureCount', NULL, 'maxAttempts', v_max_attempts);
  END IF;
  SELECT "failure_count", "disposition" INTO v_failure_count, v_disposition FROM "model_procurement_internal"."consumer_failure"
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF FOUND AND v_disposition = 'deadLetter' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'deadLetter', 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
  END IF;
  INSERT INTO "model_procurement_internal"."consumer_failure" AS failure_row ("consumer_id", "source_event_id", "failure_count", "total_failure_count", "last_delivery_attempt", "last_error_code", "max_attempts", "disposition", "terminal_at")
  VALUES (p_consumer_id, p_event_id, 1, 1, p_delivery_attempt, p_error_code, v_max_attempts, 'retry', NULL)
  ON CONFLICT ("consumer_id", "source_event_id") DO UPDATE SET
    "failure_count" = failure_row."failure_count" + 1, "total_failure_count" = failure_row."total_failure_count" + 1, "last_delivery_attempt" = GREATEST(failure_row."last_delivery_attempt", EXCLUDED."last_delivery_attempt"),
    "last_error_code" = EXCLUDED."last_error_code", "max_attempts" = v_max_attempts,
    "disposition" = 'retry', "last_failed_at" = pg_catalog.clock_timestamp(), "terminal_at" = (NULL::timestamptz), "resolved_at" = (NULL::timestamptz)
  RETURNING "failure_count" INTO v_failure_count;
  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;
  UPDATE "model_procurement_internal"."consumer_failure" SET "max_attempts" = v_max_attempts, "disposition" = v_disposition,
    "terminal_at" = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE("terminal_at", pg_catalog.clock_timestamp()) ELSE NULL END, "resolved_at" = (NULL::timestamptz)
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."record_consumer_failure"(text, text, integer, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."recover_consumer_failure"(p_consumer_id text, p_event_id text, p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_failure_count integer;
  v_total_failure_count integer;
  v_error_code text;
  v_disposition text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS recovery_role ON recovery_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE recovery_role.rolname = 'modellang_recovery' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_RECOVERY_REQUIRED';
  END IF;
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'
     OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_CONSUMER_RECOVERY';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."event_inbox" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id::uuid AND "status" = 'executed') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyConsumed', 'recovered', FALSE);
  END IF;
  SELECT "failure_count", "total_failure_count", "last_error_code", "disposition", "recovery_generation"
  INTO v_failure_count, v_total_failure_count, v_error_code, v_disposition, v_recovery_generation
  FROM "model_procurement_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_RECOVERY_STATE';
  END IF;
  v_recovery_generation := v_recovery_generation + 1;
  UPDATE "model_procurement_internal"."consumer_failure" SET "failure_count" = 0, "disposition" = 'ready',
    "recovery_generation" = v_recovery_generation, "terminal_at" = (NULL::timestamptz),
    "resolved_at" = (NULL::timestamptz), "last_recovered_at" = pg_catalog.clock_timestamp()
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  INSERT INTO "model_procurement_internal"."consumer_recovery_audit" ("consumer_id", "source_event_id", "recovery_generation", "prior_failure_count", "total_failure_count", "prior_error_code", "reason_code", "database_principal")
  VALUES (p_consumer_id, p_event_id, v_recovery_generation, v_failure_count, v_total_failure_count, v_error_code, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'recovered', 'recovered', TRUE, 'recoveryGeneration', v_recovery_generation, 'priorFailureCount', v_failure_count, 'totalFailureCount', v_total_failure_count);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."recover_consumer_failure"(text, text, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "event_id" text NOT NULL,
  "event_name" text NOT NULL,
  "payload_entity_id" text NOT NULL,
  "action_id" text,
  "consumer_id" text,
  "principal_id" uuid,
  "target_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "action_audit_id" bigint REFERENCES "model_procurement_internal"."action_audit" ("id"),
  "consumer_audit_id" bigint CONSTRAINT "fk_event_outbox_consumer_audit" REFERENCES "model_procurement_internal"."consumer_audit" ("id"),
  "command_receipt_id" bigint REFERENCES "model_procurement_internal"."command_receipt" ("id"),
  "ordinal" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "delivery_attempts" integer NOT NULL DEFAULT 0,
  "publication_failure_count" integer NOT NULL DEFAULT 0,
  "publication_total_failure_count" integer NOT NULL DEFAULT 0,
  "publication_max_attempts" integer,
  "publication_recovery_mode" text NOT NULL DEFAULT 'none',
  "publication_recovery_generation" integer NOT NULL DEFAULT 0,
  "publication_disposition" text NOT NULL DEFAULT 'pending',
  "last_publication_error_code" text,
  "publication_terminal_at" timestamptz,
  "last_publication_recovered_at" timestamptz,
  "lease_token" uuid,
  "leased_until" timestamptz,
  "published_at" timestamptz,
  CONSTRAINT "uq_event_outbox_action_ordinal" UNIQUE ("action_audit_id", "ordinal"),
  CONSTRAINT "uq_event_outbox_consumer_ordinal" UNIQUE ("consumer_audit_id", "ordinal"),
  CONSTRAINT "ck_event_outbox_producer" CHECK (("action_id" IS NOT NULL AND "action_id" ~ '^action:.+$' AND "consumer_id" IS NULL AND "action_audit_id" IS NOT NULL AND "consumer_audit_id" IS NULL AND "principal_id" IS NOT NULL) OR ("action_id" IS NULL AND "consumer_id" IS NOT NULL AND "consumer_id" ~ '^consumer:.+$' AND "action_audit_id" IS NULL AND "consumer_audit_id" IS NOT NULL AND "principal_id" IS NULL AND "command_receipt_id" IS NULL)),
  CONSTRAINT "ck_event_outbox_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_outbox_metadata" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND "publication_failure_count" >= 0 AND "publication_total_failure_count" >= "publication_failure_count" AND "publication_recovery_generation" >= 0 AND ("publication_max_attempts" IS NULL OR "publication_max_attempts" BETWEEN 1 AND 1000) AND ("publication_recovery_mode" = 'none' OR ("publication_recovery_mode" = 'manual' AND "publication_max_attempts" IS NOT NULL)) AND (("lease_token" IS NULL) = ("leased_until" IS NULL))),
  CONSTRAINT "ck_event_outbox_publication_error" CHECK ("last_publication_error_code" IS NULL OR "last_publication_error_code" ~ '^ML_[A-Z_]+$'),
  CONSTRAINT "ck_event_outbox_publication_disposition" CHECK (("publication_disposition" = 'pending' AND "published_at" IS NULL AND "publication_terminal_at" IS NULL) OR ("publication_disposition" = 'published' AND "published_at" IS NOT NULL AND "publication_terminal_at" IS NULL AND "lease_token" IS NULL) OR ("publication_disposition" = 'deadLetter' AND "published_at" IS NULL AND "publication_terminal_at" IS NOT NULL AND "lease_token" IS NULL AND "publication_max_attempts" IS NOT NULL AND "publication_failure_count" >= "publication_max_attempts"))
);
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_id" text;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_audit_id" bigint;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_failure_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_total_failure_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_max_attempts" integer;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_recovery_mode" text NOT NULL DEFAULT 'none';
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_recovery_generation" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_disposition" text NOT NULL DEFAULT 'pending';
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "last_publication_error_code" text;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_terminal_at" timestamptz;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "last_publication_recovered_at" timestamptz;
UPDATE "model_procurement_internal"."event_outbox" SET "publication_total_failure_count" = "publication_failure_count" WHERE "publication_total_failure_count" < "publication_failure_count";
UPDATE "model_procurement_internal"."event_outbox" SET "publication_disposition" = 'published' WHERE "published_at" IS NOT NULL AND "publication_disposition" = 'pending';
ALTER TABLE "model_procurement_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_delivery";
ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND "publication_failure_count" >= 0 AND "publication_total_failure_count" >= "publication_failure_count" AND "publication_recovery_generation" >= 0 AND ("publication_max_attempts" IS NULL OR "publication_max_attempts" BETWEEN 1 AND 1000) AND ("publication_recovery_mode" = 'none' OR ("publication_recovery_mode" = 'manual' AND "publication_max_attempts" IS NOT NULL)) AND (("lease_token" IS NULL) = ("leased_until" IS NULL)));
ALTER TABLE "model_procurement_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_publication_error";
ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_publication_error" CHECK ("last_publication_error_code" IS NULL OR "last_publication_error_code" ~ '^ML_[A-Z_]+$');
ALTER TABLE "model_procurement_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_publication_disposition";
ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_publication_disposition" CHECK (("publication_disposition" = 'pending' AND "published_at" IS NULL AND "publication_terminal_at" IS NULL) OR ("publication_disposition" = 'published' AND "published_at" IS NOT NULL AND "publication_terminal_at" IS NULL AND "lease_token" IS NULL) OR ("publication_disposition" = 'deadLetter' AND "published_at" IS NULL AND "publication_terminal_at" IS NOT NULL AND "lease_token" IS NULL AND "publication_max_attempts" IS NOT NULL AND "publication_failure_count" >= "publication_max_attempts"));
ALTER TABLE "model_procurement_internal"."event_outbox" ALTER COLUMN "action_id" DROP NOT NULL;
ALTER TABLE "model_procurement_internal"."event_outbox" ALTER COLUMN "principal_id" DROP NOT NULL;
ALTER TABLE "model_procurement_internal"."event_outbox" ALTER COLUMN "action_audit_id" DROP NOT NULL;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_procurement_internal"."event_outbox"'::regclass AND conname = 'fk_event_outbox_consumer_audit') THEN
    ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "fk_event_outbox_consumer_audit" FOREIGN KEY ("consumer_audit_id") REFERENCES "model_procurement_internal"."consumer_audit" ("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_procurement_internal"."event_outbox"'::regclass AND conname = 'uq_event_outbox_consumer_ordinal') THEN
    ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "uq_event_outbox_consumer_ordinal" UNIQUE ("consumer_audit_id", "ordinal");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_procurement_internal"."event_outbox"'::regclass AND conname = 'ck_event_outbox_producer') THEN
    ALTER TABLE "model_procurement_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_producer" CHECK (("action_id" IS NOT NULL AND "action_id" ~ '^action:.+$' AND "consumer_id" IS NULL AND "action_audit_id" IS NOT NULL AND "consumer_audit_id" IS NULL AND "principal_id" IS NOT NULL) OR ("action_id" IS NULL AND "consumer_id" IS NOT NULL AND "consumer_id" ~ '^consumer:.+$' AND "action_audit_id" IS NULL AND "consumer_audit_id" IS NOT NULL AND "principal_id" IS NULL AND "command_receipt_id" IS NULL));
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_recovery_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "event_outbox_id" uuid NOT NULL REFERENCES "model_procurement_internal"."event_outbox" ("id"),
  "event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "prior_failure_count" integer NOT NULL,
  "total_failure_count" integer NOT NULL,
  "prior_error_code" text NOT NULL,
  "reason_code" text NOT NULL,
  "database_principal" name NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_publication_recovery_generation" UNIQUE ("event_outbox_id", "recovery_generation"),
  CONSTRAINT "ck_publication_recovery_counts" CHECK ("recovery_generation" >= 1 AND "prior_failure_count" >= 1 AND "total_failure_count" >= "prior_failure_count"),
  CONSTRAINT "ck_publication_recovery_codes" CHECK ("prior_error_code" ~ '^ML_[A-Z_]+$' AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE INDEX IF NOT EXISTS "ix_event_outbox_delivery_v3" ON "model_procurement_internal"."event_outbox" ("occurred_at", "action_audit_id", "consumer_audit_id", "ordinal", "id") WHERE "publication_disposition" = 'pending';
CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_events"(p_limit integer, p_lease_seconds integer)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_lease_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:event_outbox';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT row_value."id" FROM "model_procurement_internal"."event_outbox" AS row_value
    WHERE row_value."publication_disposition" = 'pending' AND (row_value."leased_until" IS NULL OR row_value."leased_until" <= pg_catalog.clock_timestamp())
    ORDER BY row_value."occurred_at", (row_value."consumer_id" IS NOT NULL), COALESCE(row_value."action_audit_id", row_value."consumer_audit_id"), row_value."ordinal", row_value."id"
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), leased AS (
    UPDATE "model_procurement_internal"."event_outbox" AS row_value SET "lease_token" = v_lease_token,
      "leased_until" = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      "delivery_attempts" = row_value."delivery_attempts" + 1
    FROM candidates WHERE row_value."id" = candidates."id" RETURNING row_value.*
  )
  SELECT pg_catalog.jsonb_build_object('id', "id", 'eventId', "event_id", 'eventName', "event_name",
    'modelId', "model_id", 'modelVersion', "model_version", 'sourceHash', "source_hash", 'actionId', "action_id", 'consumerId', "consumer_id",
    'targetId', "target_id", 'payload', "payload", 'correlationId', "correlation_id",
    'causationId', "causation_id", 'occurredAt', "occurred_at", 'ordinal', "ordinal", 'deliveryAttempt', "delivery_attempts", 'leaseToken', "lease_token")
  FROM leased ORDER BY "occurred_at", ("consumer_id" IS NOT NULL), COALESCE("action_audit_id", "consumer_audit_id"), "ordinal", "id";
END
$modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."ack_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  UPDATE "model_procurement_internal"."event_outbox" SET "publication_disposition" = 'published', "published_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."release_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  UPDATE "model_procurement_internal"."event_outbox" SET "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."fail_event"(p_event_id uuid, p_lease_token uuid, p_error_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_failure_count integer;
  v_max_attempts integer;
  v_disposition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^ML_[A-Z_]+$' OR pg_catalog.length(p_error_code) > 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:event_outbox';
  END IF;
  UPDATE "model_procurement_internal"."event_outbox" SET "publication_failure_count" = "publication_failure_count" + 1, "publication_total_failure_count" = "publication_total_failure_count" + 1,
    "last_publication_error_code" = p_error_code, "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz),
    "publication_disposition" = CASE WHEN "publication_max_attempts" IS NOT NULL AND "publication_failure_count" + 1 >= "publication_max_attempts" THEN 'deadLetter' ELSE 'pending' END,
    "publication_terminal_at" = CASE WHEN "publication_max_attempts" IS NOT NULL AND "publication_failure_count" + 1 >= "publication_max_attempts" THEN pg_catalog.clock_timestamp() ELSE (NULL::timestamptz) END
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp()
  RETURNING "publication_failure_count", "publication_max_attempts", "publication_disposition" INTO v_failure_count, v_max_attempts, v_disposition;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
  RETURN pg_catalog.jsonb_build_object('status', CASE WHEN v_disposition = 'deadLetter' THEN 'deadLetter' ELSE 'retry' END, 'recorded', TRUE, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."fail_event"(uuid, uuid, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."recover_event_publication"(p_event_id uuid, p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_stable_event_id text;
  v_failure_count integer;
  v_total_failure_count integer;
  v_error_code text;
  v_disposition text;
  v_recovery_mode text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS recovery_role ON recovery_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE recovery_role.rolname = 'modellang_publication_recovery' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_PUBLICATION_RECOVERY_REQUIRED';
  END IF;
  IF p_event_id IS NULL OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_PUBLICATION_RECOVERY';
  END IF;
  SELECT "event_id", "publication_failure_count", "publication_total_failure_count", "last_publication_error_code", "publication_disposition", "publication_recovery_mode", "publication_recovery_generation"
  INTO v_stable_event_id, v_failure_count, v_total_failure_count, v_error_code, v_disposition, v_recovery_mode, v_recovery_generation
  FROM "model_procurement_internal"."event_outbox" WHERE "id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' OR v_recovery_mode <> 'manual' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_PUBLICATION_RECOVERY_STATE';
  END IF;
  v_recovery_generation := v_recovery_generation + 1;
  UPDATE "model_procurement_internal"."event_outbox" SET "publication_failure_count" = 0, "publication_disposition" = 'pending',
    "publication_recovery_generation" = v_recovery_generation, "publication_terminal_at" = (NULL::timestamptz),
    "last_publication_recovered_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id;
  INSERT INTO "model_procurement_internal"."publication_recovery_audit" ("event_outbox_id", "event_id", "recovery_generation", "prior_failure_count", "total_failure_count", "prior_error_code", "reason_code", "database_principal")
  VALUES (p_event_id, v_stable_event_id, v_recovery_generation, v_failure_count, v_total_failure_count, v_error_code, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'recovered', 'recoveryGeneration', v_recovery_generation, 'priorFailureCount', v_failure_count, 'totalFailureCount', v_total_failure_count);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."recover_event_publication"(uuid, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_failure_acknowledgement" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "event_outbox_id" uuid NOT NULL REFERENCES "model_procurement_internal"."event_outbox" ("id"),
  "event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "reason_code" text NOT NULL,
  "database_principal" name NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_publication_failure_acknowledgement_cycle" UNIQUE ("event_outbox_id", "recovery_generation"),
  CONSTRAINT "ck_publication_failure_acknowledgement" CHECK ("recovery_generation" >= 0 AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_failure_acknowledgement" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "consumer_id" text NOT NULL,
  "source_event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "reason_code" text NOT NULL,
  "database_principal" name NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_consumer_failure_acknowledgement_cycle" UNIQUE ("consumer_id", "source_event_id", "recovery_generation"),
  CONSTRAINT "fk_consumer_failure_acknowledgement" FOREIGN KEY ("consumer_id", "source_event_id") REFERENCES "model_procurement_internal"."consumer_failure" ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_failure_acknowledgement" CHECK ("recovery_generation" >= 0 AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE OR REPLACE FUNCTION "model_procurement_internal"."acknowledge_terminal_publication_failure"(p_event_id uuid, p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_stable_event_id text;
  v_disposition text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS acknowledger_role ON acknowledger_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE acknowledger_role.rolname = 'modellang_failure_acknowledger' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_ACKNOWLEDGER_REQUIRED';
  END IF;
  IF p_event_id IS NULL OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_PUBLICATION_FAILURE_ACKNOWLEDGEMENT';
  END IF;
  SELECT "event_id", "publication_disposition", "publication_recovery_generation"
  INTO v_stable_event_id, v_disposition, v_recovery_generation
  FROM "model_procurement_internal"."event_outbox" WHERE "id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_PUBLICATION_FAILURE_ACKNOWLEDGEMENT_STATE';
  END IF;
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."publication_failure_acknowledgement" WHERE "event_outbox_id" = p_event_id AND "recovery_generation" = v_recovery_generation) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyAcknowledged', 'acknowledged', TRUE, 'recoveryGeneration', v_recovery_generation);
  END IF;
  INSERT INTO "model_procurement_internal"."publication_failure_acknowledgement" ("event_outbox_id", "event_id", "recovery_generation", "reason_code", "database_principal")
  VALUES (p_event_id, v_stable_event_id, v_recovery_generation, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'acknowledged', 'acknowledged', TRUE, 'recoveryGeneration', v_recovery_generation);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."acknowledge_terminal_publication_failure"(uuid, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."acknowledge_terminal_consumer_failure"(p_consumer_id text, p_event_id text, p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_disposition text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS acknowledger_role ON acknowledger_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE acknowledger_role.rolname = 'modellang_failure_acknowledger' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_ACKNOWLEDGER_REQUIRED';
  END IF;
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'
     OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_CONSUMER_FAILURE_ACKNOWLEDGEMENT';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  SELECT "disposition", "recovery_generation" INTO v_disposition, v_recovery_generation
  FROM "model_procurement_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_FAILURE_ACKNOWLEDGEMENT_STATE';
  END IF;
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."consumer_failure_acknowledgement" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id AND "recovery_generation" = v_recovery_generation) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyAcknowledged', 'acknowledged', TRUE, 'recoveryGeneration', v_recovery_generation);
  END IF;
  INSERT INTO "model_procurement_internal"."consumer_failure_acknowledgement" ("consumer_id", "source_event_id", "recovery_generation", "reason_code", "database_principal")
  VALUES (p_consumer_id, p_event_id, v_recovery_generation, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'acknowledged', 'acknowledged', TRUE, 'recoveryGeneration', v_recovery_generation);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."acknowledge_terminal_consumer_failure"(text, text, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_failure_claim" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "event_outbox_id" uuid NOT NULL REFERENCES "model_procurement_internal"."event_outbox" ("id"),
  "event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "claimant_principal" name NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_publication_failure_claim_cycle" UNIQUE ("event_outbox_id", "recovery_generation"),
  CONSTRAINT "ck_publication_failure_claim" CHECK ("recovery_generation" >= 0)
);
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_failure_claim" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "consumer_id" text NOT NULL,
  "source_event_id" text NOT NULL,
  "recovery_generation" integer NOT NULL,
  "claimant_principal" name NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "uq_consumer_failure_claim_cycle" UNIQUE ("consumer_id", "source_event_id", "recovery_generation"),
  CONSTRAINT "fk_consumer_failure_claim" FOREIGN KEY ("consumer_id", "source_event_id") REFERENCES "model_procurement_internal"."consumer_failure" ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_failure_claim" CHECK ("recovery_generation" >= 0)
);
CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_terminal_publication_failure"(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_stable_event_id text;
  v_disposition text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS claimant_role ON claimant_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE claimant_role.rolname = 'modellang_failure_claimant' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_CLAIMANT_REQUIRED';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_PUBLICATION_FAILURE_CLAIM';
  END IF;
  SELECT "event_id", "publication_disposition", "publication_recovery_generation"
  INTO v_stable_event_id, v_disposition, v_recovery_generation
  FROM "model_procurement_internal"."event_outbox" WHERE "id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_PUBLICATION_FAILURE_CLAIM_STATE';
  END IF;
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."publication_failure_claim" WHERE "event_outbox_id" = p_event_id AND "recovery_generation" = v_recovery_generation) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyClaimed', 'claimed', TRUE, 'recoveryGeneration', v_recovery_generation);
  END IF;
  INSERT INTO "model_procurement_internal"."publication_failure_claim" ("event_outbox_id", "event_id", "recovery_generation", "claimant_principal")
  VALUES (p_event_id, v_stable_event_id, v_recovery_generation, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'claimed', 'claimed', TRUE, 'recoveryGeneration', v_recovery_generation);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."claim_terminal_publication_failure"(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_terminal_consumer_failure"(p_consumer_id text, p_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_disposition text;
  v_recovery_generation integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS claimant_role ON claimant_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE claimant_role.rolname = 'modellang_failure_claimant' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_CLAIMANT_REQUIRED';
  END IF;
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_CONSUMER_FAILURE_CLAIM';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  SELECT "disposition", "recovery_generation" INTO v_disposition, v_recovery_generation
  FROM "model_procurement_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_FAILURE_CLAIM_STATE';
  END IF;
  IF EXISTS (SELECT 1 FROM "model_procurement_internal"."consumer_failure_claim" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id AND "recovery_generation" = v_recovery_generation) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyClaimed', 'claimed', TRUE, 'recoveryGeneration', v_recovery_generation);
  END IF;
  INSERT INTO "model_procurement_internal"."consumer_failure_claim" ("consumer_id", "source_event_id", "recovery_generation", "claimant_principal")
  VALUES (p_consumer_id, p_event_id, v_recovery_generation, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'claimed', 'claimed', TRUE, 'recoveryGeneration', v_recovery_generation);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."claim_terminal_consumer_failure"(text, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."failure_observation_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "database_principal" name NOT NULL,
  "failure_kind" text NOT NULL,
  "snapshot_at" timestamptz NOT NULL,
  "after_terminal_at" timestamptz,
  "after_identity" text,
  "requested_limit" integer NOT NULL,
  "returned_count" integer NOT NULL,
  "has_more" boolean NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT "ck_failure_observation_kind" CHECK ("failure_kind" IN ('publication', 'consumer')),
  CONSTRAINT "ck_failure_observation_cursor" CHECK (("after_terminal_at" IS NULL) = ("after_identity" IS NULL)),
  CONSTRAINT "ck_failure_observation_counts" CHECK ("requested_limit" BETWEEN 1 AND 100 AND "returned_count" BETWEEN 0 AND "requested_limit")
);
CREATE INDEX IF NOT EXISTS "ix_event_outbox_terminal_observation" ON "model_procurement_internal"."event_outbox" ("publication_terminal_at", "id") WHERE "publication_disposition" = 'deadLetter';
CREATE INDEX IF NOT EXISTS "ix_consumer_failure_terminal_observation" ON "model_procurement_internal"."consumer_failure" ("terminal_at", "consumer_id", "source_event_id") WHERE "disposition" = 'deadLetter';
CREATE OR REPLACE FUNCTION "model_procurement_internal"."observe_terminal_publications"(p_snapshot_at timestamptz, p_after_terminal_at timestamptz, p_after_event_id uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_snapshot_at timestamptz;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS observer_role ON observer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE observer_role.rolname = 'modellang_failure_observer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_OBSERVER_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT ((p_snapshot_at IS NULL AND p_after_terminal_at IS NULL AND p_after_event_id IS NULL)
             OR (p_snapshot_at IS NOT NULL AND p_after_terminal_at IS NOT NULL AND p_after_event_id IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_FAILURE_OBSERVATION_CURSOR';
  END IF;
  v_snapshot_at := COALESCE(p_snapshot_at, pg_catalog.clock_timestamp());
  IF v_snapshot_at > pg_catalog.clock_timestamp() OR (p_after_terminal_at IS NOT NULL AND p_after_terminal_at > v_snapshot_at) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_FAILURE_OBSERVATION_CURSOR';
  END IF;
  WITH candidates AS (
    SELECT row_value."publication_terminal_at" AS terminal_at, row_value."id" AS event_instance_id,
      row_value."event_id" AS event_id, row_value."publication_failure_count" AS failure_count,
      row_value."publication_total_failure_count" AS total_failure_count, row_value."publication_max_attempts" AS max_attempts,
      row_value."last_publication_error_code" AS last_error_code, row_value."publication_recovery_generation" AS recovery_generation,
      row_value."publication_recovery_mode" = 'manual' AS recovery_eligible, EXISTS (SELECT 1 FROM "model_procurement_internal"."publication_failure_acknowledgement" AS acknowledgement WHERE acknowledgement."event_outbox_id" = row_value."id" AND acknowledgement."recovery_generation" = row_value."publication_recovery_generation") AS acknowledged, EXISTS (SELECT 1 FROM "model_procurement_internal"."publication_failure_claim" AS failure_claim WHERE failure_claim."event_outbox_id" = row_value."id" AND failure_claim."recovery_generation" = row_value."publication_recovery_generation") AS claimed
    FROM "model_procurement_internal"."event_outbox" AS row_value
    WHERE row_value."publication_disposition" = 'deadLetter' AND row_value."publication_terminal_at" <= v_snapshot_at
      AND (p_after_terminal_at IS NULL OR (row_value."publication_terminal_at", row_value."id") > (p_after_terminal_at, p_after_event_id))
    ORDER BY row_value."publication_terminal_at", row_value."id" LIMIT p_limit + 1
  ), page_rows AS (SELECT * FROM candidates ORDER BY terminal_at, event_instance_id LIMIT p_limit),
  stats AS (SELECT pg_catalog.count(*) AS candidate_count FROM candidates)
  SELECT pg_catalog.jsonb_build_object(
    'snapshotAt', v_snapshot_at,
    'items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind', 'publication', 'eventInstanceId', event_instance_id, 'eventId', event_id,
      'failureCount', failure_count, 'totalFailureCount', total_failure_count, 'maxAttempts', max_attempts,
      'lastErrorCode', last_error_code, 'terminalAt', terminal_at, 'recoveryGeneration', recovery_generation,
      'recoveryEligible', recovery_eligible, 'acknowledged', acknowledged, 'claimed', claimed) ORDER BY terminal_at, event_instance_id) FROM page_rows), '[]'::jsonb),
    'nextCursor', CASE WHEN stats.candidate_count > p_limit THEN (SELECT pg_catalog.jsonb_build_object(
      'snapshotAt', v_snapshot_at, 'afterTerminalAt', terminal_at, 'afterEventInstanceId', event_instance_id)
      FROM page_rows ORDER BY terminal_at DESC, event_instance_id DESC LIMIT 1) ELSE NULL END)
  INTO v_result FROM stats;
  INSERT INTO "model_procurement_internal"."failure_observation_audit" ("database_principal", "failure_kind", "snapshot_at", "after_terminal_at", "after_identity", "requested_limit", "returned_count", "has_more")
  VALUES (session_user, 'publication', v_snapshot_at, p_after_terminal_at, p_after_event_id::text, p_limit, pg_catalog.jsonb_array_length(v_result->'items'), v_result->'nextCursor' <> 'null'::jsonb);
  RETURN v_result;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."observe_terminal_consumers"(p_snapshot_at timestamptz, p_after_terminal_at timestamptz, p_after_consumer_id text, p_after_event_id uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_snapshot_at timestamptz;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS observer_role ON observer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE observer_role.rolname = 'modellang_failure_observer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_FAILURE_OBSERVER_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT ((p_snapshot_at IS NULL AND p_after_terminal_at IS NULL AND p_after_consumer_id IS NULL AND p_after_event_id IS NULL)
             OR (p_snapshot_at IS NOT NULL AND p_after_terminal_at IS NOT NULL AND p_after_consumer_id IS NOT NULL AND p_after_event_id IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_FAILURE_OBSERVATION_CURSOR';
  END IF;
  v_snapshot_at := COALESCE(p_snapshot_at, pg_catalog.clock_timestamp());
  IF v_snapshot_at > pg_catalog.clock_timestamp() OR (p_after_terminal_at IS NOT NULL AND p_after_terminal_at > v_snapshot_at) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_FAILURE_OBSERVATION_CURSOR';
  END IF;
  WITH candidates AS (
    SELECT row_value."terminal_at" AS terminal_at, row_value."consumer_id" AS consumer_id,
      row_value."source_event_id"::uuid AS event_instance_id, row_value."failure_count" AS failure_count,
      row_value."total_failure_count" AS total_failure_count, row_value."max_attempts" AS max_attempts,
      row_value."last_error_code" AS last_error_code, row_value."recovery_generation" AS recovery_generation,
      row_value."consumer_id" IN ('consumer:con_10d694c9a0a274dc79c6168e47d25968') AS recovery_eligible, EXISTS (SELECT 1 FROM "model_procurement_internal"."consumer_failure_acknowledgement" AS acknowledgement WHERE acknowledgement."consumer_id" = row_value."consumer_id" AND acknowledgement."source_event_id" = row_value."source_event_id" AND acknowledgement."recovery_generation" = row_value."recovery_generation") AS acknowledged, EXISTS (SELECT 1 FROM "model_procurement_internal"."consumer_failure_claim" AS failure_claim WHERE failure_claim."consumer_id" = row_value."consumer_id" AND failure_claim."source_event_id" = row_value."source_event_id" AND failure_claim."recovery_generation" = row_value."recovery_generation") AS claimed
    FROM "model_procurement_internal"."consumer_failure" AS row_value
    WHERE row_value."disposition" = 'deadLetter' AND row_value."terminal_at" <= v_snapshot_at
      AND (p_after_terminal_at IS NULL OR (row_value."terminal_at", row_value."consumer_id", row_value."source_event_id"::uuid) > (p_after_terminal_at, p_after_consumer_id, p_after_event_id))
    ORDER BY row_value."terminal_at", row_value."consumer_id", row_value."source_event_id"::uuid LIMIT p_limit + 1
  ), page_rows AS (SELECT * FROM candidates ORDER BY terminal_at, consumer_id, event_instance_id LIMIT p_limit),
  stats AS (SELECT pg_catalog.count(*) AS candidate_count FROM candidates)
  SELECT pg_catalog.jsonb_build_object(
    'snapshotAt', v_snapshot_at,
    'items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind', 'consumer', 'consumerId', consumer_id, 'eventInstanceId', event_instance_id,
      'failureCount', failure_count, 'totalFailureCount', total_failure_count, 'maxAttempts', max_attempts,
      'lastErrorCode', last_error_code, 'terminalAt', terminal_at, 'recoveryGeneration', recovery_generation,
      'recoveryEligible', recovery_eligible, 'acknowledged', acknowledged, 'claimed', claimed) ORDER BY terminal_at, consumer_id, event_instance_id) FROM page_rows), '[]'::jsonb),
    'nextCursor', CASE WHEN stats.candidate_count > p_limit THEN (SELECT pg_catalog.jsonb_build_object(
      'snapshotAt', v_snapshot_at, 'afterTerminalAt', terminal_at, 'afterConsumerId', consumer_id, 'afterEventInstanceId', event_instance_id)
      FROM page_rows ORDER BY terminal_at DESC, consumer_id DESC, event_instance_id DESC LIMIT 1) ELSE NULL END)
  INTO v_result FROM stats;
  INSERT INTO "model_procurement_internal"."failure_observation_audit" ("database_principal", "failure_kind", "snapshot_at", "after_terminal_at", "after_identity", "requested_limit", "returned_count", "has_more")
  VALUES (session_user, 'consumer', v_snapshot_at, p_after_terminal_at, CASE WHEN p_after_consumer_id IS NULL THEN NULL ELSE p_after_consumer_id || ':' || p_after_event_id::text END, p_limit, pg_catalog.jsonb_array_length(v_result->'items'), v_result->'nextCursor' <> 'null'::jsonb);
  RETURN v_result;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."observe_terminal_consumers"(timestamptz, timestamptz, text, uuid, integer) FROM PUBLIC;

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
VALUES ('model:Procurement', '0.38.0', 'sha256:a4a1c2c6f15a13da6049c57ef6d27ae86de48de2282303fe845c3d5b54e64a77', 'installation');
RESET ROLE;

