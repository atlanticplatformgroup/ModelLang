-- Idempotent ModelLang 0.20 -> 0.21 reliable typed event-consumer upgrade.
-- No historical events are consumed and no inbox completion is fabricated.
BEGIN;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_consumer') THEN
    CREATE ROLE modellang_consumer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_consumer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;
REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_recovery') THEN
    CREATE ROLE modellang_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer FROM modellang_recovery;
REVOKE modellang_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;

DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_publication_recovery') THEN
    CREATE ROLE modellang_publication_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_publication_recovery NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery FROM modellang_publication_recovery;
REVOKE modellang_publication_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT "model_id", "version", "source_hash"
  INTO v_model_id, v_version, v_source_hash
  FROM "model_reservations_internal"."schema_migrations"
  ORDER BY "id" DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM 'model:Reservations'
     OR v_version IS DISTINCT FROM '0.29.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:d9a86d5833c534acd18355e3bde514f2f7b23aad3d87323fb5faf19af69696f3' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:d9a86d5833c534acd18355e3bde514f2f7b23aad3d87323fb5faf19af69696f3';
  END IF;
END
$modellang_upgrade$;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."consumer_audit" (
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
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."event_inbox" (
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
  "consumer_audit_id" bigint REFERENCES "model_reservations_internal"."consumer_audit" ("id"),
  "claimed_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "completed_at" timestamptz,
  CONSTRAINT "uq_event_inbox_identity" UNIQUE ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_event_inbox_hashes" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$' AND "envelope_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_inbox_attempts" CHECK ("first_delivery_attempt" >= 1 AND "last_delivery_attempt" >= "first_delivery_attempt"),
  CONSTRAINT "ck_event_inbox_status" CHECK (("status" = 'claimed' AND "response" IS NULL AND "completed_at" IS NULL AND "consumer_audit_id" IS NULL) OR ("status" = 'executed' AND "response" IS NOT NULL AND "completed_at" IS NOT NULL AND "consumer_audit_id" IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."consumer_failure" (
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
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "total_failure_count" integer;
UPDATE "model_reservations_internal"."consumer_failure" SET "total_failure_count" = "failure_count" WHERE "total_failure_count" IS NULL;
ALTER TABLE "model_reservations_internal"."consumer_failure" ALTER COLUMN "total_failure_count" SET DEFAULT 1;
ALTER TABLE "model_reservations_internal"."consumer_failure" ALTER COLUMN "total_failure_count" SET NOT NULL;
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "recovery_generation" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "max_attempts" integer;
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "disposition" text NOT NULL DEFAULT 'retry';
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "terminal_at" timestamptz;
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "last_recovered_at" timestamptz;
ALTER TABLE "model_reservations_internal"."consumer_failure" DROP CONSTRAINT IF EXISTS "ck_consumer_failure_count";
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD CONSTRAINT "ck_consumer_failure_count" CHECK ("failure_count" >= 0 AND "total_failure_count" >= 1 AND "total_failure_count" >= "failure_count" AND "recovery_generation" >= 0 AND "last_delivery_attempt" >= 1);
ALTER TABLE "model_reservations_internal"."consumer_failure" DROP CONSTRAINT IF EXISTS "ck_consumer_failure_disposition";
ALTER TABLE "model_reservations_internal"."consumer_failure" ADD CONSTRAINT "ck_consumer_failure_disposition" CHECK (
  ("disposition" = 'ready' AND "failure_count" = 0 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'retry' AND "failure_count" >= 1 AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'deadLetter' AND "max_attempts" IS NOT NULL AND "failure_count" >= "max_attempts" AND "terminal_at" IS NOT NULL AND "resolved_at" IS NULL)
  OR ("disposition" = 'resolved' AND "terminal_at" IS NULL AND "resolved_at" IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."consumer_recovery_audit" (
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
  CONSTRAINT "fk_consumer_recovery_failure" FOREIGN KEY ("consumer_id", "source_event_id") REFERENCES "model_reservations_internal"."consumer_failure" ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_recovery_counts" CHECK ("recovery_generation" >= 1 AND "prior_failure_count" >= 1 AND "total_failure_count" >= "prior_failure_count"),
  CONSTRAINT "ck_consumer_recovery_codes" CHECK ("prior_error_code" ~ '^ML_[A-Z_]+$' AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE OR REPLACE FUNCTION "model_reservations_internal"."consumer_failure_state"(p_consumer_id text, p_event_id text) RETURNS jsonb
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
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_20d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  p_event_id := p_event_id::uuid::text;
  v_max_attempts := CASE p_consumer_id WHEN 'consumer:con_20d694c9a0a274dc79c6168e47d25968' THEN 3 ELSE NULL END;
  SELECT "failure_count", "last_error_code", "disposition" INTO v_failure_count, v_error_code, v_disposition
  FROM "model_reservations_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition IN ('ready', 'resolved') THEN RETURN pg_catalog.jsonb_build_object('status', 'ready'); END IF;
  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;
  UPDATE "model_reservations_internal"."consumer_failure" SET "max_attempts" = v_max_attempts, "disposition" = v_disposition,
    "terminal_at" = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE("terminal_at", pg_catalog.clock_timestamp()) ELSE NULL END, "resolved_at" = (NULL::timestamptz)
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', v_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consumer_failure_state"(text, text) FROM PUBLIC;
DROP FUNCTION IF EXISTS "model_reservations_internal"."record_consumer_failure"(text, text, integer, text);
CREATE FUNCTION "model_reservations_internal"."record_consumer_failure"(p_consumer_id text, p_event_id text, p_delivery_attempt integer, p_error_code text) RETURNS jsonb
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
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_20d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'
     OR p_delivery_attempt IS NULL OR p_delivery_attempt < 1 OR p_error_code IS NULL OR p_error_code !~ '^ML_[A-Z_]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  v_max_attempts := CASE p_consumer_id WHEN 'consumer:con_20d694c9a0a274dc79c6168e47d25968' THEN 3 ELSE NULL END;
  IF EXISTS (SELECT 1 FROM "model_reservations_internal"."event_inbox" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id::uuid AND "status" = 'executed') THEN
    UPDATE "model_reservations_internal"."consumer_failure" SET "disposition" = 'resolved', "max_attempts" = v_max_attempts, "terminal_at" = (NULL::timestamptz), "resolved_at" = COALESCE("resolved_at", pg_catalog.clock_timestamp())
    WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
    RETURN pg_catalog.jsonb_build_object('status', 'ignoredCommitted', 'recorded', FALSE, 'errorCode', p_error_code, 'failureCount', NULL, 'maxAttempts', v_max_attempts);
  END IF;
  SELECT "failure_count", "disposition" INTO v_failure_count, v_disposition FROM "model_reservations_internal"."consumer_failure"
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF FOUND AND v_disposition = 'deadLetter' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'deadLetter', 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
  END IF;
  INSERT INTO "model_reservations_internal"."consumer_failure" AS failure_row ("consumer_id", "source_event_id", "failure_count", "total_failure_count", "last_delivery_attempt", "last_error_code", "max_attempts", "disposition", "terminal_at")
  VALUES (p_consumer_id, p_event_id, 1, 1, p_delivery_attempt, p_error_code, v_max_attempts, 'retry', NULL)
  ON CONFLICT ("consumer_id", "source_event_id") DO UPDATE SET
    "failure_count" = failure_row."failure_count" + 1, "total_failure_count" = failure_row."total_failure_count" + 1, "last_delivery_attempt" = GREATEST(failure_row."last_delivery_attempt", EXCLUDED."last_delivery_attempt"),
    "last_error_code" = EXCLUDED."last_error_code", "max_attempts" = v_max_attempts,
    "disposition" = 'retry', "last_failed_at" = pg_catalog.clock_timestamp(), "terminal_at" = (NULL::timestamptz), "resolved_at" = (NULL::timestamptz)
  RETURNING "failure_count" INTO v_failure_count;
  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;
  UPDATE "model_reservations_internal"."consumer_failure" SET "max_attempts" = v_max_attempts, "disposition" = v_disposition,
    "terminal_at" = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE("terminal_at", pg_catalog.clock_timestamp()) ELSE NULL END, "resolved_at" = (NULL::timestamptz)
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."recover_consumer_failure"(p_consumer_id text, p_event_id text, p_reason_code text) RETURNS jsonb
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
  IF p_consumer_id IS NULL OR p_consumer_id NOT IN ('consumer:con_20d694c9a0a274dc79c6168e47d25968') OR p_event_id IS NULL OR p_event_id !~ '^[0-9a-fA-F-]{36}$'
     OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_CONSUMER_RECOVERY';
  END IF;
  p_event_id := p_event_id::uuid::text;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_consumer_id || ':' || p_event_id, 0));
  IF EXISTS (SELECT 1 FROM "model_reservations_internal"."event_inbox" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id::uuid AND "status" = 'executed') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'alreadyConsumed', 'recovered', FALSE);
  END IF;
  SELECT "failure_count", "total_failure_count", "last_error_code", "disposition", "recovery_generation"
  INTO v_failure_count, v_total_failure_count, v_error_code, v_disposition, v_recovery_generation
  FROM "model_reservations_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_RECOVERY_STATE';
  END IF;
  v_recovery_generation := v_recovery_generation + 1;
  UPDATE "model_reservations_internal"."consumer_failure" SET "failure_count" = 0, "disposition" = 'ready',
    "recovery_generation" = v_recovery_generation, "terminal_at" = (NULL::timestamptz),
    "resolved_at" = (NULL::timestamptz), "last_recovered_at" = pg_catalog.clock_timestamp()
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  INSERT INTO "model_reservations_internal"."consumer_recovery_audit" ("consumer_id", "source_event_id", "recovery_generation", "prior_failure_count", "total_failure_count", "prior_error_code", "reason_code", "database_principal")
  VALUES (p_consumer_id, p_event_id, v_recovery_generation, v_failure_count, v_total_failure_count, v_error_code, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'recovered', 'recovered', TRUE, 'recoveryGeneration', v_recovery_generation, 'priorFailureCount', v_failure_count, 'totalFailureCount', v_total_failure_count);
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."recover_consumer_failure"(text, text, text) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."event_outbox" (
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
  "action_audit_id" bigint REFERENCES "model_reservations_internal"."action_audit" ("id"),
  "consumer_audit_id" bigint CONSTRAINT "fk_event_outbox_consumer_audit" REFERENCES "model_reservations_internal"."consumer_audit" ("id"),
  "command_receipt_id" bigint REFERENCES "model_reservations_internal"."command_receipt" ("id"),
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
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_id" text;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_audit_id" bigint;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_failure_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_total_failure_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_max_attempts" integer;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_recovery_mode" text NOT NULL DEFAULT 'none';
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_recovery_generation" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_disposition" text NOT NULL DEFAULT 'pending';
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "last_publication_error_code" text;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "publication_terminal_at" timestamptz;
ALTER TABLE "model_reservations_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "last_publication_recovered_at" timestamptz;
UPDATE "model_reservations_internal"."event_outbox" SET "publication_total_failure_count" = "publication_failure_count" WHERE "publication_total_failure_count" < "publication_failure_count";
UPDATE "model_reservations_internal"."event_outbox" SET "publication_disposition" = 'published' WHERE "published_at" IS NOT NULL AND "publication_disposition" = 'pending';
ALTER TABLE "model_reservations_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_delivery";
ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND "publication_failure_count" >= 0 AND "publication_total_failure_count" >= "publication_failure_count" AND "publication_recovery_generation" >= 0 AND ("publication_max_attempts" IS NULL OR "publication_max_attempts" BETWEEN 1 AND 1000) AND ("publication_recovery_mode" = 'none' OR ("publication_recovery_mode" = 'manual' AND "publication_max_attempts" IS NOT NULL)) AND (("lease_token" IS NULL) = ("leased_until" IS NULL)));
ALTER TABLE "model_reservations_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_publication_error";
ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_publication_error" CHECK ("last_publication_error_code" IS NULL OR "last_publication_error_code" ~ '^ML_[A-Z_]+$');
ALTER TABLE "model_reservations_internal"."event_outbox" DROP CONSTRAINT IF EXISTS "ck_event_outbox_publication_disposition";
ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_publication_disposition" CHECK (("publication_disposition" = 'pending' AND "published_at" IS NULL AND "publication_terminal_at" IS NULL) OR ("publication_disposition" = 'published' AND "published_at" IS NOT NULL AND "publication_terminal_at" IS NULL AND "lease_token" IS NULL) OR ("publication_disposition" = 'deadLetter' AND "published_at" IS NULL AND "publication_terminal_at" IS NOT NULL AND "lease_token" IS NULL AND "publication_max_attempts" IS NOT NULL AND "publication_failure_count" >= "publication_max_attempts"));
ALTER TABLE "model_reservations_internal"."event_outbox" ALTER COLUMN "action_id" DROP NOT NULL;
ALTER TABLE "model_reservations_internal"."event_outbox" ALTER COLUMN "principal_id" DROP NOT NULL;
ALTER TABLE "model_reservations_internal"."event_outbox" ALTER COLUMN "action_audit_id" DROP NOT NULL;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_reservations_internal"."event_outbox"'::regclass AND conname = 'fk_event_outbox_consumer_audit') THEN
    ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "fk_event_outbox_consumer_audit" FOREIGN KEY ("consumer_audit_id") REFERENCES "model_reservations_internal"."consumer_audit" ("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_reservations_internal"."event_outbox"'::regclass AND conname = 'uq_event_outbox_consumer_ordinal') THEN
    ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "uq_event_outbox_consumer_ordinal" UNIQUE ("consumer_audit_id", "ordinal");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_reservations_internal"."event_outbox"'::regclass AND conname = 'ck_event_outbox_producer') THEN
    ALTER TABLE "model_reservations_internal"."event_outbox" ADD CONSTRAINT "ck_event_outbox_producer" CHECK (("action_id" IS NOT NULL AND "action_id" ~ '^action:.+$' AND "consumer_id" IS NULL AND "action_audit_id" IS NOT NULL AND "consumer_audit_id" IS NULL AND "principal_id" IS NOT NULL) OR ("action_id" IS NULL AND "consumer_id" IS NOT NULL AND "consumer_id" ~ '^consumer:.+$' AND "action_audit_id" IS NULL AND "consumer_audit_id" IS NOT NULL AND "principal_id" IS NULL AND "command_receipt_id" IS NULL));
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."publication_recovery_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "event_outbox_id" uuid NOT NULL REFERENCES "model_reservations_internal"."event_outbox" ("id"),
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
CREATE INDEX IF NOT EXISTS "ix_event_outbox_delivery_v3" ON "model_reservations_internal"."event_outbox" ("occurred_at", "action_audit_id", "consumer_audit_id", "ordinal", "id") WHERE "publication_disposition" = 'pending';
CREATE OR REPLACE FUNCTION "model_reservations_internal"."claim_events"(p_limit integer, p_lease_seconds integer)
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
    SELECT row_value."id" FROM "model_reservations_internal"."event_outbox" AS row_value
    WHERE row_value."publication_disposition" = 'pending' AND (row_value."leased_until" IS NULL OR row_value."leased_until" <= pg_catalog.clock_timestamp())
    ORDER BY row_value."occurred_at", (row_value."consumer_id" IS NOT NULL), COALESCE(row_value."action_audit_id", row_value."consumer_audit_id"), row_value."ordinal", row_value."id"
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), leased AS (
    UPDATE "model_reservations_internal"."event_outbox" AS row_value SET "lease_token" = v_lease_token,
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
REVOKE ALL ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."ack_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
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
  UPDATE "model_reservations_internal"."event_outbox" SET "publication_disposition" = 'published', "published_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."release_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
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
  UPDATE "model_reservations_internal"."event_outbox" SET "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."fail_event"(p_event_id uuid, p_lease_token uuid, p_error_code text) RETURNS jsonb
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
  UPDATE "model_reservations_internal"."event_outbox" SET "publication_failure_count" = "publication_failure_count" + 1, "publication_total_failure_count" = "publication_total_failure_count" + 1,
    "last_publication_error_code" = p_error_code, "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz),
    "publication_disposition" = CASE WHEN "publication_max_attempts" IS NOT NULL AND "publication_failure_count" + 1 >= "publication_max_attempts" THEN 'deadLetter' ELSE 'pending' END,
    "publication_terminal_at" = CASE WHEN "publication_max_attempts" IS NOT NULL AND "publication_failure_count" + 1 >= "publication_max_attempts" THEN pg_catalog.clock_timestamp() ELSE (NULL::timestamptz) END
  WHERE "id" = p_event_id AND "publication_disposition" = 'pending' AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp()
  RETURNING "publication_failure_count", "publication_max_attempts", "publication_disposition" INTO v_failure_count, v_max_attempts, v_disposition;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
  RETURN pg_catalog.jsonb_build_object('status', CASE WHEN v_disposition = 'deadLetter' THEN 'deadLetter' ELSE 'retry' END, 'recorded', TRUE, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."fail_event"(uuid, uuid, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."recover_event_publication"(p_event_id uuid, p_reason_code text) RETURNS jsonb
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
  FROM "model_reservations_internal"."event_outbox" WHERE "id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition <> 'deadLetter' OR v_recovery_mode <> 'manual' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_PUBLICATION_RECOVERY_STATE';
  END IF;
  v_recovery_generation := v_recovery_generation + 1;
  UPDATE "model_reservations_internal"."event_outbox" SET "publication_failure_count" = 0, "publication_disposition" = 'pending',
    "publication_recovery_generation" = v_recovery_generation, "publication_terminal_at" = (NULL::timestamptz),
    "last_publication_recovered_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id;
  INSERT INTO "model_reservations_internal"."publication_recovery_audit" ("event_outbox_id", "event_id", "recovery_generation", "prior_failure_count", "total_failure_count", "prior_error_code", "reason_code", "database_principal")
  VALUES (p_event_id, v_stable_event_id, v_recovery_generation, v_failure_count, v_total_failure_count, v_error_code, p_reason_code, session_user);
  RETURN pg_catalog.jsonb_build_object('status', 'recovered', 'recoveryGeneration', v_recovery_generation, 'priorFailureCount', v_failure_count, 'totalFailureCount', v_total_failure_count);
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."recover_event_publication"(uuid, text) FROM PUBLIC;
RESET ROLE;

-- Generated private transactional event consumers. Broker transport remains host-owned.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations_internal"."consume_index_reservation"(p_envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_source_event_id uuid;
  v_target_id uuid;
  v_source_model_id text;
  v_source_model_version text;
  v_source_hash text;
  v_envelope_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_delivery_attempt integer;
  v_correlation_id text;
  v_causation_id text;
  v_payload_json jsonb;
  v_envelope_keys text[];
  v_payload_keys text[];
  v_failure_state jsonb;
  v_inbox_id bigint;
  v_consumer_audit_id bigint;
  v_authority_policy_id text;
  v_authority_id text;
  v_response jsonb;
  v_payload "model_reservations"."reservation"%ROWTYPE;
  v_result "model_reservations"."reservation"%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS consumer_role ON consumer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE consumer_role.rolname = 'modellang_consumer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_REQUIRED';
  END IF;
  IF p_envelope IS NULL OR pg_catalog.jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_envelope_keys FROM pg_catalog.jsonb_object_keys(p_envelope) AS key_name;
  IF v_envelope_keys IS NOT DISTINCT FROM ARRAY['actionId', 'causationId', 'correlationId', 'deliveryAttempt', 'eventId', 'eventName', 'id', 'modelId', 'modelVersion', 'occurredAt', 'ordinal', 'payload', 'sourceHash', 'targetId']::text[] THEN
    p_envelope := p_envelope || pg_catalog.jsonb_build_object('consumerId', NULL);
  ELSIF v_envelope_keys IS DISTINCT FROM ARRAY['actionId', 'causationId', 'consumerId', 'correlationId', 'deliveryAttempt', 'eventId', 'eventName', 'id', 'modelId', 'modelVersion', 'occurredAt', 'ordinal', 'payload', 'sourceHash', 'targetId']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  IF pg_catalog.jsonb_typeof(p_envelope->'id') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventName') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelVersion') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'sourceHash') IS DISTINCT FROM 'string'
     OR (p_envelope->'actionId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'actionId') IS DISTINCT FROM 'string')
     OR (p_envelope->'consumerId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'consumerId') IS DISTINCT FROM 'string')
     OR pg_catalog.jsonb_typeof(p_envelope->'targetId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'payload') IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_envelope->'correlationId') IS DISTINCT FROM 'string'
     OR (p_envelope->'causationId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'causationId') IS DISTINCT FROM 'string')
     OR pg_catalog.jsonb_typeof(p_envelope->'occurredAt') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'ordinal') IS DISTINCT FROM 'number'
     OR pg_catalog.jsonb_typeof(p_envelope->'deliveryAttempt') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  BEGIN
    v_source_event_id := (p_envelope->>'id')::uuid;
    v_target_id := (p_envelope->>'targetId')::uuid;
    v_delivery_attempt := (p_envelope->>'deliveryAttempt')::integer;
    PERFORM (p_envelope->>'occurredAt')::timestamptz, (p_envelope->>'ordinal')::integer;
  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END;
  v_source_model_id := p_envelope->>'modelId';
  v_source_model_version := p_envelope->>'modelVersion';
  v_source_hash := p_envelope->>'sourceHash';
  v_correlation_id := p_envelope->>'correlationId';
  v_causation_id := p_envelope->>'causationId';
  v_payload_json := p_envelope->'payload';
  IF p_envelope->>'eventId' IS DISTINCT FROM 'event:evt_40d694c9a0a274dc79c6168e47d25968'
     OR p_envelope->>'eventName' IS DISTINCT FROM 'ReservationCreated'
     OR v_source_model_id IS DISTINCT FROM 'model:Reservations'
     OR v_source_model_version IS DISTINCT FROM '0.29.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:d9a86d5833c534acd18355e3bde514f2f7b23aad3d87323fb5faf19af69696f3'
     OR NOT ((((p_envelope->>'actionId') IS NOT NULL AND (p_envelope->>'actionId' ~ '^action:.+$') AND p_envelope->'consumerId' = 'null'::jsonb)
              OR (p_envelope->'actionId' = 'null'::jsonb AND (p_envelope->>'consumerId') IS NOT NULL AND (p_envelope->>'consumerId' ~ '^consumer:.+$'))) IS TRUE)
     OR (p_envelope->>'ordinal')::integer < 0
     OR v_delivery_attempt < 1
     OR v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_CONTRACT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('consumer:con_20d694c9a0a274dc79c6168e47d25968:' || v_source_event_id::text, 0));
  v_failure_state := "model_reservations_internal"."consumer_failure_state"('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id::text);
  IF v_failure_state->>'status' = 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_DEAD_LETTER';
  END IF;
  v_envelope_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(((p_envelope - 'deliveryAttempt'))::text, 'UTF8')), 'hex');
  INSERT INTO "model_reservations_internal"."event_inbox" ("consumer_id", "source_event_id", "source_event_type", "source_event_name", "source_model_id", "source_model_version", "source_hash", "envelope_hash", "payload", "correlation_id", "causation_id", "first_delivery_attempt", "last_delivery_attempt")
  VALUES ('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'ReservationCreated', v_source_model_id, v_source_model_version, v_source_hash, v_envelope_hash, v_payload_json, v_correlation_id, v_causation_id, v_delivery_attempt, v_delivery_attempt)
  ON CONFLICT ("consumer_id", "source_event_id") DO NOTHING RETURNING "id" INTO v_inbox_id;
  IF v_inbox_id IS NULL THEN
    SELECT "envelope_hash", "status", "response" INTO v_existing_hash, v_existing_status, v_existing_response
    FROM "model_reservations_internal"."event_inbox" WHERE "consumer_id" = 'consumer:con_20d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id FOR UPDATE;
    IF v_existing_hash IS DISTINCT FROM v_envelope_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_EVENT_CONFLICT';
    END IF;
    IF v_existing_status IS DISTINCT FROM 'executed' OR v_existing_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_EVENT_INCOMPLETE';
    END IF;
    UPDATE "model_reservations_internal"."event_inbox" SET "last_delivery_attempt" = GREATEST("last_delivery_attempt", v_delivery_attempt) WHERE "consumer_id" = 'consumer:con_20d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id;
    RETURN v_existing_response;
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_payload_keys FROM pg_catalog.jsonb_object_keys(v_payload_json) AS key_name;
  IF v_payload_keys IS DISTINCT FROM ARRAY['createdAt', 'endsAt', 'id', 'indexed', 'reservedBy', 'resource', 'startsAt']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'id') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'createdAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'resource') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'reservedBy') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'startsAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'endsAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'indexed') = 'boolean') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  BEGIN
    SELECT (v_payload_json->'id'#>>'{}')::uuid, (v_payload_json->'createdAt'#>>'{}')::timestamptz, (v_payload_json->'resource'#>>'{}')::uuid, (v_payload_json->'reservedBy'#>>'{}')::uuid, (v_payload_json->'startsAt'#>>'{}')::timestamptz, (v_payload_json->'endsAt'#>>'{}')::timestamptz, (v_payload_json->'indexed'#>>'{}')::boolean
    INTO v_payload;
  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END;
  IF v_payload.id IS DISTINCT FROM v_target_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT * INTO v_result FROM "model_reservations"."reservation" WHERE "id" = v_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_TARGET'; END IF;
  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_AUTHORIZATION:authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968';
  END IF;
  IF NOT (((v_payload."starts_at" < v_payload."ends_at")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_CONSUMER_PRECONDITION:require:consumer:con_20d694c9a0a274dc79c6168e47d25968.valid_interval';
  END IF;
  UPDATE "model_reservations"."reservation" SET "indexed" = TRUE WHERE "id" = v_target_id RETURNING * INTO v_result;
  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at", 'indexed', v_result."indexed");
  INSERT INTO "model_reservations_internal"."consumer_audit" ("consumer_id", "source_event_id", "source_event_type", "source_model_id", "source_model_version", "source_hash", "target_id", "authorization_rule_id", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id")
  VALUES ('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_40d694c9a0a274dc79c6168e47d25968', v_source_model_id, v_source_model_version, v_source_hash, v_result."id", 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 1, 'outcome', 'consumed', 'consumerId', 'consumer:con_20d694c9a0a274dc79c6168e47d25968', 'sourceEventId', v_source_event_id, 'sourceContract', pg_catalog.jsonb_build_object('eventId', 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'modelId', v_source_model_id, 'modelVersion', v_source_model_version, 'sourceHash', v_source_hash), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:consumer:con_20d694c9a0a274dc79c6168e47d25968.valid_interval', 'outcome', 'passed')), 'emittedEventIds', pg_catalog.to_jsonb(ARRAY['event:evt_60d694c9a0a274dc79c6168e47d25968']::text[]), 'failurePolicy', pg_catalog.jsonb_build_object('mode', 'deadLetterAfterMaxAttempts', 'maxAttempts', 3, 'recovery', 'manual')), v_correlation_id, v_causation_id) RETURNING "id" INTO v_consumer_audit_id;
  INSERT INTO "model_reservations_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "consumer_id", "target_id", "payload", "correlation_id", "causation_id", "consumer_audit_id", "ordinal", "publication_max_attempts", "publication_recovery_mode")
  VALUES ('model:Reservations', '0.29.0', 'sha256:d9a86d5833c534acd18355e3bde514f2f7b23aad3d87323fb5faf19af69696f3', 'event:evt_60d694c9a0a274dc79c6168e47d25968', 'ReservationIndexed', 'entity:ent_ba2d028e915841d1ab90adfa40d38404', 'consumer:con_20d694c9a0a274dc79c6168e47d25968', v_result."id", v_response, v_correlation_id, v_source_event_id::text, v_consumer_audit_id, 0, 5, 'manual');

  UPDATE "model_reservations_internal"."consumer_failure" SET "disposition" = 'resolved', "max_attempts" = 3, "terminal_at" = (NULL::timestamptz), "resolved_at" = pg_catalog.clock_timestamp()
  WHERE "consumer_id" = 'consumer:con_20d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id::text;
  UPDATE "model_reservations_internal"."event_inbox" SET "status" = 'executed', "target_id" = v_result."id", "response" = v_response, "consumer_audit_id" = v_consumer_audit_id, "completed_at" = pg_catalog.transaction_timestamp() WHERE "id" = v_inbox_id;
  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_publication_recovery;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery, modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."fail_event"(uuid, uuid, text) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;
REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer FROM modellang_recovery;
REVOKE modellang_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery FROM modellang_publication_recovery;
REVOKE modellang_publication_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
