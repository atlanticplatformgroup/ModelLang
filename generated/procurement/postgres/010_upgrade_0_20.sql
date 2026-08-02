-- Idempotent ModelLang 0.19 -> 0.20 transactional domain-event upgrade.
-- Existing domain and audit rows do not synthesize historical events; new executions append events atomically.
BEGIN;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_dispatcher') THEN
    CREATE ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
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
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT "model_id", "version", "source_hash"
  INTO v_model_id, v_version, v_source_hash
  FROM "model_procurement_internal"."schema_migrations"
  ORDER BY "id" DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM 'model:Procurement'
     OR v_version IS DISTINCT FROM '0.23.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17';
  END IF;
END
$modellang_upgrade$;
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
  "last_delivery_attempt" integer NOT NULL,
  "last_error_code" text NOT NULL,
  "max_attempts" integer,
  "disposition" text NOT NULL DEFAULT 'retry',
  "last_failed_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  "terminal_at" timestamptz,
  "resolved_at" timestamptz,
  PRIMARY KEY ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_failure_count" CHECK ("failure_count" >= 1 AND "last_delivery_attempt" >= 1),
  CONSTRAINT "ck_consumer_failure_code" CHECK ("last_error_code" ~ '^ML_[A-Z_]+$'),
  CONSTRAINT "ck_consumer_failure_disposition" CHECK (
    ("disposition" = 'retry' AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
    OR ("disposition" = 'deadLetter' AND "max_attempts" IS NOT NULL AND "failure_count" >= "max_attempts" AND "terminal_at" IS NOT NULL AND "resolved_at" IS NULL)
    OR ("disposition" = 'resolved' AND "terminal_at" IS NULL AND "resolved_at" IS NOT NULL)
  )
);
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "max_attempts" integer;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "disposition" text NOT NULL DEFAULT 'retry';
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "terminal_at" timestamptz;
ALTER TABLE "model_procurement_internal"."consumer_failure" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = '"model_procurement_internal"."consumer_failure"'::regclass AND conname = 'ck_consumer_failure_disposition') THEN
    ALTER TABLE "model_procurement_internal"."consumer_failure" ADD CONSTRAINT "ck_consumer_failure_disposition" CHECK (
      ("disposition" = 'retry' AND "terminal_at" IS NULL AND "resolved_at" IS NULL)
      OR ("disposition" = 'deadLetter' AND "max_attempts" IS NOT NULL AND "failure_count" >= "max_attempts" AND "terminal_at" IS NOT NULL AND "resolved_at" IS NULL)
      OR ("disposition" = 'resolved' AND "terminal_at" IS NULL AND "resolved_at" IS NOT NULL)
    );
  END IF;
END
$modellang$;
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
  v_max_attempts := CASE p_consumer_id WHEN 'consumer:con_10d694c9a0a274dc79c6168e47d25968' THEN 3 ELSE NULL END;
  SELECT "failure_count", "last_error_code", "disposition" INTO v_failure_count, v_error_code, v_disposition
  FROM "model_procurement_internal"."consumer_failure" WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_disposition = 'resolved' THEN RETURN pg_catalog.jsonb_build_object('status', 'ready'); END IF;
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
  INSERT INTO "model_procurement_internal"."consumer_failure" AS failure_row ("consumer_id", "source_event_id", "failure_count", "last_delivery_attempt", "last_error_code", "max_attempts", "disposition", "terminal_at")
  VALUES (p_consumer_id, p_event_id, 1, p_delivery_attempt, p_error_code, v_max_attempts, 'retry', NULL)
  ON CONFLICT ("consumer_id", "source_event_id") DO UPDATE SET
    "failure_count" = failure_row."failure_count" + 1, "last_delivery_attempt" = GREATEST(failure_row."last_delivery_attempt", EXCLUDED."last_delivery_attempt"),
    "last_error_code" = EXCLUDED."last_error_code", "max_attempts" = v_max_attempts,
    "last_failed_at" = pg_catalog.clock_timestamp(), "resolved_at" = (NULL::timestamptz)
  RETURNING "failure_count" INTO v_failure_count;
  v_disposition := CASE WHEN v_max_attempts IS NOT NULL AND v_failure_count >= v_max_attempts THEN 'deadLetter' ELSE 'retry' END;
  UPDATE "model_procurement_internal"."consumer_failure" SET "max_attempts" = v_max_attempts, "disposition" = v_disposition,
    "terminal_at" = CASE WHEN v_disposition = 'deadLetter' THEN COALESCE("terminal_at", pg_catalog.clock_timestamp()) ELSE NULL END, "resolved_at" = (NULL::timestamptz)
  WHERE "consumer_id" = p_consumer_id AND "source_event_id" = p_event_id;
  RETURN pg_catalog.jsonb_build_object('status', v_disposition, 'recorded', TRUE, 'errorCode', p_error_code, 'failureCount', v_failure_count, 'maxAttempts', v_max_attempts);
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."record_consumer_failure"(text, text, integer, text) FROM PUBLIC;
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
  "lease_token" uuid,
  "leased_until" timestamptz,
  "published_at" timestamptz,
  CONSTRAINT "uq_event_outbox_action_ordinal" UNIQUE ("action_audit_id", "ordinal"),
  CONSTRAINT "uq_event_outbox_consumer_ordinal" UNIQUE ("consumer_audit_id", "ordinal"),
  CONSTRAINT "ck_event_outbox_producer" CHECK (("action_id" IS NOT NULL AND "action_id" ~ '^action:.+$' AND "consumer_id" IS NULL AND "action_audit_id" IS NOT NULL AND "consumer_audit_id" IS NULL AND "principal_id" IS NOT NULL) OR ("action_id" IS NULL AND "consumer_id" IS NOT NULL AND "consumer_id" ~ '^consumer:.+$' AND "action_audit_id" IS NULL AND "consumer_audit_id" IS NOT NULL AND "principal_id" IS NULL AND "command_receipt_id" IS NULL)),
  CONSTRAINT "ck_event_outbox_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_outbox_metadata" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND (("lease_token" IS NULL) = ("leased_until" IS NULL)) AND ("published_at" IS NULL OR ("lease_token" IS NULL AND "leased_until" IS NULL)))
);
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_id" text;
ALTER TABLE "model_procurement_internal"."event_outbox" ADD COLUMN IF NOT EXISTS "consumer_audit_id" bigint;
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
CREATE INDEX IF NOT EXISTS "ix_event_outbox_delivery_v2" ON "model_procurement_internal"."event_outbox" ("occurred_at", "action_audit_id", "consumer_audit_id", "ordinal", "id") WHERE "published_at" IS NULL;
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
    WHERE row_value."published_at" IS NULL AND (row_value."leased_until" IS NULL OR row_value."leased_until" <= pg_catalog.clock_timestamp())
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
  UPDATE "model_procurement_internal"."event_outbox" SET "published_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
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
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) FROM PUBLIC;
RESET ROLE;

-- Generated guarded action functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."open_request"("p_amount" numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_REQUIRED:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, v_idempotency_key);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
     OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF NOT (("p_amount" <> 'NaN'::numeric AND pg_catalog.scale("p_amount") <= 2 AND pg_catalog.abs("p_amount") < 1000000000000000000) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount';
  END IF;

  v_request_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object('actionId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'inputs', pg_catalog.jsonb_build_object('parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2))), 'expectedRevision', v_expected_revision, 'correlationId', v_correlation_id, 'causationId', v_causation_id))::text, 'UTF8')), 'hex');
  INSERT INTO "model_procurement_internal"."command_receipt" ("model_id", "model_version", "source_hash", "action_id", "principal_id", "idempotency_key", "request_hash", "correlation_id", "causation_id")
  VALUES ('model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_procurement_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_1e35db0451b1461e941af6283d86dca2' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_IDEMPOTENCY_CONFLICT:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
    END IF;
    IF v_receipt_status IS DISTINCT FROM 'executed' OR v_receipt_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_IDEMPOTENCY_INCOMPLETE:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
    END IF;
    RETURN v_receipt_response;
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2)))))::text);

  IF NOT ((((('EMPLOYEE' = ANY(v_actor."roles")) OR ('MANAGER' = ANY(v_actor."roles"))) OR ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF NOT ((("p_amount" > 0)) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount';
  END IF;

  INSERT INTO "model_procurement"."purchase_request" ("requester_id", "amount", "status", "approved_by_id", "approved_by_roles")
  VALUES (v_actor."id", "p_amount", 'DRAFT', NULL, NULL)
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles", 'approvalObserved', v_result."approval_observed");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_1e35db0451b1461e941af6283d86dca2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.23.0', 'sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17'), 'actionId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'event:evt_10d694c9a0a274dc79c6168e47d25968', 'RequestOpened', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  UPDATE "model_procurement_internal"."command_receipt"
  SET "status" = 'executed', "response" = v_response, "target_id" = v_result."id",
      "action_audit_id" = v_action_audit_id, "completed_at" = pg_catalog.transaction_timestamp()
  WHERE "id" = v_receipt_id;

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."submit_request"("p_request" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_UNSUPPORTED:idempotency:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, pg_catalog.gen_random_uuid()::text);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF NOT (((v_actor."id" = v_request."requester_id")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  IF NOT (((v_request."status" = 'DRAFT')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_ed2374e822704c51a2925338253d05d2.is_draft';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'SUBMITTED'
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles", 'approvalObserved', v_result."approval_observed");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_ed2374e822704c51a2925338253d05d2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.23.0', 'sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17'), 'actionId', 'action:act_ed2374e822704c51a2925338253d05d2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_ed2374e822704c51a2925338253d05d2.is_draft', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'event:evt_20d694c9a0a274dc79c6168e47d25968', 'RequestSubmitted', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_ed2374e822704c51a2925338253d05d2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."submit_request"(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."approve_request"("p_request" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_UNSUPPORTED:idempotency:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, pg_catalog.gen_random_uuid()::text);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END) + (CASE WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END)) = 1))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  v_authority_policy_id := 'policy:pol_a3a80ffeec774402be92cddaafd0f069';
  v_authority_id := CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 'policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688' WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 'policyBranch:pbr_6b38447b5bf944769d1d737c069c7420' ELSE NULL END;

  IF NOT (((v_request."status" = 'SUBMITTED')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'APPROVED',
      "approved_by_id" = v_actor."id",
      "approved_by_roles" = v_actor."roles"
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles", 'approvalObserved', v_result."approval_observed");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_d39dbb883b5f4019b9027b85add3de47', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.23.0', 'sourceHash', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17'), 'actionId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'event:evt_30d694c9a0a274dc79c6168e47d25968', 'RequestApproved', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_d39dbb883b5f4019b9027b85add3de47', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;

RESET ROLE;
-- Generated private transactional event consumers. Broker transport remains host-owned.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement_internal"."consume_observe_request_approval"(p_envelope jsonb) RETURNS jsonb
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
  v_payload "model_procurement"."purchase_request"%ROWTYPE;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
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
  IF p_envelope->>'eventId' IS DISTINCT FROM 'event:evt_30d694c9a0a274dc79c6168e47d25968'
     OR p_envelope->>'eventName' IS DISTINCT FROM 'RequestApproved'
     OR v_source_model_id IS DISTINCT FROM 'model:Procurement'
     OR v_source_model_version IS DISTINCT FROM '0.23.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17'
     OR NOT ((((p_envelope->>'actionId') IS NOT NULL AND (p_envelope->>'actionId' ~ '^action:.+$') AND p_envelope->'consumerId' = 'null'::jsonb)
              OR (p_envelope->'actionId' = 'null'::jsonb AND (p_envelope->>'consumerId') IS NOT NULL AND (p_envelope->>'consumerId' ~ '^consumer:.+$'))) IS TRUE)
     OR (p_envelope->>'ordinal')::integer < 0
     OR v_delivery_attempt < 1
     OR v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_CONTRACT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('consumer:con_10d694c9a0a274dc79c6168e47d25968:' || v_source_event_id::text, 0));
  v_failure_state := "model_procurement_internal"."consumer_failure_state"('consumer:con_10d694c9a0a274dc79c6168e47d25968', v_source_event_id::text);
  IF v_failure_state->>'status' = 'deadLetter' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_CONSUMER_DEAD_LETTER';
  END IF;
  v_envelope_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(((p_envelope - 'deliveryAttempt'))::text, 'UTF8')), 'hex');
  INSERT INTO "model_procurement_internal"."event_inbox" ("consumer_id", "source_event_id", "source_event_type", "source_event_name", "source_model_id", "source_model_version", "source_hash", "envelope_hash", "payload", "correlation_id", "causation_id", "first_delivery_attempt", "last_delivery_attempt")
  VALUES ('consumer:con_10d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_30d694c9a0a274dc79c6168e47d25968', 'RequestApproved', v_source_model_id, v_source_model_version, v_source_hash, v_envelope_hash, v_payload_json, v_correlation_id, v_causation_id, v_delivery_attempt, v_delivery_attempt)
  ON CONFLICT ("consumer_id", "source_event_id") DO NOTHING RETURNING "id" INTO v_inbox_id;
  IF v_inbox_id IS NULL THEN
    SELECT "envelope_hash", "status", "response" INTO v_existing_hash, v_existing_status, v_existing_response
    FROM "model_procurement_internal"."event_inbox" WHERE "consumer_id" = 'consumer:con_10d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id FOR UPDATE;
    IF v_existing_hash IS DISTINCT FROM v_envelope_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_EVENT_CONFLICT';
    END IF;
    IF v_existing_status IS DISTINCT FROM 'executed' OR v_existing_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_EVENT_INCOMPLETE';
    END IF;
    UPDATE "model_procurement_internal"."event_inbox" SET "last_delivery_attempt" = GREATEST("last_delivery_attempt", v_delivery_attempt) WHERE "consumer_id" = 'consumer:con_10d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id;
    RETURN v_existing_response;
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_payload_keys FROM pg_catalog.jsonb_object_keys(v_payload_json) AS key_name;
  IF v_payload_keys IS DISTINCT FROM ARRAY['amount', 'approvalObserved', 'approvedBy', 'approvedByRoles', 'createdAt', 'id', 'requester', 'status']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'id') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'createdAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'requester') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT (((pg_catalog.jsonb_typeof(v_payload_json->'amount') = 'object' AND (SELECT pg_catalog.array_agg(key_name ORDER BY key_name) FROM pg_catalog.jsonb_object_keys(v_payload_json->'amount') AS key_name) = ARRAY['amount','currency']::text[] AND v_payload_json->'amount'->>'currency' = 'USD' AND pg_catalog.jsonb_typeof(v_payload_json->'amount'->'amount') = 'string' AND v_payload_json->'amount'->>'amount' ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT (((pg_catalog.jsonb_typeof(v_payload_json->'status') = 'string' AND v_payload_json->'status'#>>'{}' IN ('DRAFT', 'SUBMITTED', 'APPROVED'))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((v_payload_json->'approvedBy' = 'null'::jsonb OR pg_catalog.jsonb_typeof(v_payload_json->'approvedBy') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((v_payload_json->'approvedByRoles' = 'null'::jsonb OR (pg_catalog.jsonb_typeof(v_payload_json->'approvedByRoles') = 'array' AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_payload_json->'approvedByRoles') AS item WHERE pg_catalog.jsonb_typeof(item) <> 'string' OR item#>>'{}' NOT IN ('EMPLOYEE', 'MANAGER', 'FINANCE')) AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_payload_json->'approvedByRoles')) = (SELECT pg_catalog.count(DISTINCT item#>>'{}') FROM pg_catalog.jsonb_array_elements(v_payload_json->'approvedByRoles') AS item))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'approvalObserved') = 'boolean') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  BEGIN
    SELECT (v_payload_json->'id'#>>'{}')::uuid, (v_payload_json->'createdAt'#>>'{}')::timestamptz, (v_payload_json->'requester'#>>'{}')::uuid, (v_payload_json->'amount'->>'amount')::numeric, v_payload_json->'status'#>>'{}', CASE WHEN v_payload_json->'approvedBy' = 'null'::jsonb THEN NULL ELSE (v_payload_json->'approvedBy'#>>'{}')::uuid END, CASE WHEN v_payload_json->'approvedByRoles' = 'null'::jsonb THEN NULL ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text(v_payload_json->'approvedByRoles')) END, (v_payload_json->'approvalObserved'#>>'{}')::boolean
    INTO v_payload;
  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END;
  IF NOT (((v_payload."amount" <> 'NaN'::numeric AND pg_catalog.scale(v_payload."amount") <= 2 AND pg_catalog.abs(v_payload."amount") < 1000000000000000000)) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF v_payload.id IS DISTINCT FROM v_target_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT * INTO v_result FROM "model_procurement"."purchase_request" WHERE "id" = v_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_TARGET'; END IF;
  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_AUTHORIZATION:authorize:consumer:con_10d694c9a0a274dc79c6168e47d25968';
  END IF;
  IF NOT (((v_payload."status" = 'APPROVED')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_CONSUMER_PRECONDITION:require:consumer:con_10d694c9a0a274dc79c6168e47d25968.is_approved';
  END IF;
  UPDATE "model_procurement"."purchase_request" SET "approval_observed" = TRUE WHERE "id" = v_target_id RETURNING * INTO v_result;
  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles", 'approvalObserved', v_result."approval_observed");
  INSERT INTO "model_procurement_internal"."consumer_audit" ("consumer_id", "source_event_id", "source_event_type", "source_model_id", "source_model_version", "source_hash", "target_id", "authorization_rule_id", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id")
  VALUES ('consumer:con_10d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_30d694c9a0a274dc79c6168e47d25968', v_source_model_id, v_source_model_version, v_source_hash, v_result."id", 'authorize:consumer:con_10d694c9a0a274dc79c6168e47d25968', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 1, 'outcome', 'consumed', 'consumerId', 'consumer:con_10d694c9a0a274dc79c6168e47d25968', 'sourceEventId', v_source_event_id, 'sourceContract', pg_catalog.jsonb_build_object('eventId', 'event:evt_30d694c9a0a274dc79c6168e47d25968', 'modelId', v_source_model_id, 'modelVersion', v_source_model_version, 'sourceHash', v_source_hash), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:consumer:con_10d694c9a0a274dc79c6168e47d25968', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:consumer:con_10d694c9a0a274dc79c6168e47d25968.is_approved', 'outcome', 'passed')), 'emittedEventIds', pg_catalog.to_jsonb(ARRAY['event:evt_50d694c9a0a274dc79c6168e47d25968']::text[]), 'failurePolicy', pg_catalog.jsonb_build_object('mode', 'deadLetterAfterMaxAttempts', 'maxAttempts', 3)), v_correlation_id, v_causation_id) RETURNING "id" INTO v_consumer_audit_id;
  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "consumer_id", "target_id", "payload", "correlation_id", "causation_id", "consumer_audit_id", "ordinal")
  VALUES ('model:Procurement', '0.23.0', 'sha256:80fbd2d1c323960f6c3521d8607e6669048353cd3f6055a75a43d8eea765dc17', 'event:evt_50d694c9a0a274dc79c6168e47d25968', 'ApprovalObserved', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'consumer:con_10d694c9a0a274dc79c6168e47d25968', v_result."id", v_response, v_correlation_id, v_source_event_id::text, v_consumer_audit_id, 0);

  UPDATE "model_procurement_internal"."consumer_failure" SET "disposition" = 'resolved', "max_attempts" = 3, "terminal_at" = (NULL::timestamptz), "resolved_at" = pg_catalog.clock_timestamp()
  WHERE "consumer_id" = 'consumer:con_10d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id::text;
  UPDATE "model_procurement_internal"."event_inbox" SET "status" = 'executed', "target_id" = v_result."id", "response" = v_response, "consumer_audit_id" = v_consumer_audit_id, "completed_at" = pg_catalog.transaction_timestamp() WHERE "id" = v_inbox_id;
  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_consumer;

REVOKE ALL ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."open_request"(numeric) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."submit_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."submit_request"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."approve_request"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."my_requests"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."my_requests"() TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;
REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
