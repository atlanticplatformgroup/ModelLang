-- Idempotent ModelLang 0.11 -> 0.12 PostgreSQL gateway-boundary upgrade.
-- Run as the same administrative role used for generated installation and migrations.
BEGIN;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_gateway') THEN
    CREATE ROLE modellang_gateway NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_gateway NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
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
     OR v_version IS DISTINCT FROM '0.20.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1';
  END IF;
END
$modellang_upgrade$;

CREATE TABLE IF NOT EXISTS "model_reservations_internal"."gateway_principal_binding" (
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "principal_id" uuid NOT NULL REFERENCES "model_reservations"."user" ("id"),
  PRIMARY KEY ("issuer", "subject"),
  CONSTRAINT "ck_gateway_principal_binding_identity" CHECK (
    pg_catalog.char_length("issuer") BETWEEN 1 AND 512
    AND pg_catalog.char_length("subject") BETWEEN 1 AND 512
  )
);
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_issuer" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_subject" text;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_reservations_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_gateway_identity'
  ) THEN
    ALTER TABLE "model_reservations_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_gateway_identity"
      CHECK (("identity_issuer" IS NULL) = ("identity_subject" IS NULL));
  END IF;
END
$modellang$;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."bind_gateway_identity"(p_issuer text, p_subject text)
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
  PERFORM 1 FROM "model_reservations_internal"."gateway_principal_binding" AS binding
  WHERE binding."issuer" = p_issuer AND binding."subject" = p_subject
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
  PERFORM pg_catalog.set_config('modellang.gateway_issuer', p_issuer, true);
  PERFORM pg_catalog.set_config('modellang.gateway_subject', p_subject, true);
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."resolve_principal"()
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
      FROM "model_reservations_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject
      FOR SHARE;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id", NULL::text, NULL::text
      FROM "model_reservations_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user
      FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."resolve_principal"() FROM PUBLIC;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_version" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "source_hash" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authorization_rule_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_outcome" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "policy_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authority_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_evidence" jsonb;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_reservations_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_decision_evidence'
  ) THEN
    ALTER TABLE "model_reservations_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_decision_evidence" CHECK (
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
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."command_receipt" (
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
  "action_audit_id" bigint UNIQUE REFERENCES "model_reservations_internal"."action_audit" ("id"),
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
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "correlation_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "causation_id" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "command_receipt_id" bigint;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_action_audit_command_receipt" ON "model_reservations_internal"."action_audit" ("command_receipt_id") WHERE "command_receipt_id" IS NOT NULL;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_reservations_internal"."action_audit"'::regclass AND conname = 'fk_action_audit_command_receipt'
  ) THEN
    ALTER TABLE "model_reservations_internal"."action_audit" ADD CONSTRAINT "fk_action_audit_command_receipt" FOREIGN KEY ("command_receipt_id") REFERENCES "model_reservations_internal"."command_receipt" ("id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_reservations_internal"."action_audit"'::regclass AND conname = 'ck_action_audit_command_metadata'
  ) THEN
    ALTER TABLE "model_reservations_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_command_metadata" CHECK (
      ("correlation_id" IS NULL AND "causation_id" IS NULL AND "command_receipt_id" IS NULL)
      OR ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))
    );
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "event_id" text NOT NULL,
  "event_name" text NOT NULL,
  "payload_entity_id" text NOT NULL,
  "action_id" text NOT NULL,
  "principal_id" uuid NOT NULL,
  "target_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "action_audit_id" bigint NOT NULL REFERENCES "model_reservations_internal"."action_audit" ("id"),
  "command_receipt_id" bigint REFERENCES "model_reservations_internal"."command_receipt" ("id"),
  "ordinal" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "delivery_attempts" integer NOT NULL DEFAULT 0,
  "lease_token" uuid,
  "leased_until" timestamptz,
  "published_at" timestamptz,
  CONSTRAINT "uq_event_outbox_action_ordinal" UNIQUE ("action_audit_id", "ordinal"),
  CONSTRAINT "ck_event_outbox_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_outbox_metadata" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND (("lease_token" IS NULL) = ("leased_until" IS NULL)) AND ("published_at" IS NULL OR ("lease_token" IS NULL AND "leased_until" IS NULL)))
);
CREATE INDEX IF NOT EXISTS "ix_event_outbox_delivery" ON "model_reservations_internal"."event_outbox" ("occurred_at", "action_audit_id", "ordinal", "id") WHERE "published_at" IS NULL;
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
    WHERE row_value."published_at" IS NULL AND (row_value."leased_until" IS NULL OR row_value."leased_until" <= pg_catalog.clock_timestamp())
    ORDER BY row_value."occurred_at", row_value."action_audit_id", row_value."ordinal", row_value."id"
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), leased AS (
    UPDATE "model_reservations_internal"."event_outbox" AS row_value SET "lease_token" = v_lease_token,
      "leased_until" = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      "delivery_attempts" = row_value."delivery_attempts" + 1
    FROM candidates WHERE row_value."id" = candidates."id" RETURNING row_value.*
  )
  SELECT pg_catalog.jsonb_build_object('id', "id", 'eventId', "event_id", 'eventName', "event_name",
    'modelId', "model_id", 'modelVersion', "model_version", 'sourceHash', "source_hash", 'actionId', "action_id",
    'targetId', "target_id", 'payload', "payload", 'correlationId', "correlation_id",
    'causationId', "causation_id", 'occurredAt', "occurred_at", 'ordinal', "ordinal", 'deliveryAttempt', "delivery_attempts", 'leaseToken', "lease_token")
  FROM leased ORDER BY "occurred_at", "action_audit_id", "ordinal", "id";
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
  UPDATE "model_reservations_internal"."event_outbox" SET "published_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
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
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) FROM PUBLIC;
RESET ROLE;

-- Existing guarded callables must resolve both direct and gateway identities.
-- Generated guarded action functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."reserve"("p_resource" uuid, "p_starts_at" timestamptz, "p_ends_at" timestamptz)
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
  v_result "model_reservations"."reservation"%ROWTYPE;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_actor_xmin text;
  v_resource "model_reservations"."resource"%ROWTYPE;
  v_resource_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_reservations_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_REQUIRED:idempotency:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, v_idempotency_key);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
     OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;

  v_request_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object('actionId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'inputs', pg_catalog.jsonb_build_object('parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', pg_catalog.to_jsonb("p_resource"), 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', pg_catalog.to_jsonb("p_starts_at"), 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', pg_catalog.to_jsonb("p_ends_at")), 'expectedRevision', v_expected_revision, 'correlationId', v_correlation_id, 'causationId', v_causation_id))::text, 'UTF8')), 'hex');
  INSERT INTO "model_reservations_internal"."command_receipt" ("model_id", "model_version", "source_hash", "action_id", "principal_id", "idempotency_key", "request_hash", "correlation_id", "causation_id")
  VALUES ('model:Reservations', '0.20.0', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1', 'action:act_508ad810a19d4b79a5009871de5cd26b', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_reservations_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_508ad810a19d4b79a5009871de5cd26b' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_IDEMPOTENCY_CONFLICT:idempotency:action:act_508ad810a19d4b79a5009871de5cd26b';
    END IF;
    IF v_receipt_status IS DISTINCT FROM 'executed' OR v_receipt_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_IDEMPOTENCY_INCOMPLETE:idempotency:action:act_508ad810a19d4b79a5009871de5cd26b';
    END IF;
    RETURN v_receipt_response;
  END IF;

  PERFORM "id" FROM "model_reservations"."resource"
  WHERE "id" = ANY (ARRAY["p_resource"]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_reservations"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;

  SELECT row_value.xmin::text INTO v_resource_xmin
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource";

  SELECT * INTO v_actor
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_508ad810a19d4b79a5009871de5cd26b';
  END IF;

  IF NOT ((("p_starts_at" < "p_ends_at")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval';
  END IF;

  INSERT INTO "model_reservations"."reservation" ("resource_id", "reserved_by_id", "starts_at", "ends_at")
  VALUES (v_resource."id", v_actor."id", "p_starts_at", "p_ends_at")
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at");
  INSERT INTO "model_reservations_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_508ad810a19d4b79a5009871de5cd26b', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Reservations', '0.20.0', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Reservations', 'version', '0.20.0', 'sourceHash', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1'), 'actionId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_reservations_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Reservations', '0.20.0', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1', 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'ReservationCreated', 'entity:ent_ba2d028e915841d1ab90adfa40d38404', 'action:act_508ad810a19d4b79a5009871de5cd26b', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  UPDATE "model_reservations_internal"."command_receipt"
  SET "status" = 'executed', "response" = v_response, "target_id" = v_result."id",
      "action_audit_id" = v_action_audit_id, "completed_at" = pg_catalog.transaction_timestamp()
  WHERE "id" = v_receipt_id;

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;

RESET ROLE;
-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."reservations_for_resource"("p_resource" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_resource "model_reservations"."resource"%ROWTYPE;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_reservations_internal"."resolve_principal"() AS identity;

  SELECT * INTO v_actor
  FROM "model_reservations"."user"
  WHERE "id" = v_principal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource"
  WHERE "id" = "p_resource";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(v_query."item" ORDER BY v_query."sort_value" ASC, v_query."identity" ASC),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object('id', v_row."id", 'createdAt', v_row."created_at", 'resource', v_row."resource_id", 'reservedBy', v_row."reserved_by_id", 'startsAt', v_row."starts_at", 'endsAt', v_row."ends_at") AS "item",
           v_row."starts_at" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_reservations"."reservation" AS v_row
    WHERE (((v_row."resource_id" = v_resource."id")) IS TRUE)
    ORDER BY v_row."starts_at" ASC, v_row."id" ASC
    LIMIT 100
  ) AS v_query;

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) TO modellang_app;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
