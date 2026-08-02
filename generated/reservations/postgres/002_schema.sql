-- source sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA "model_reservations" AUTHORIZATION modellang_owner;
CREATE SCHEMA "model_reservations_internal" AUTHORIZATION modellang_owner;
SET ROLE modellang_owner;
REVOKE ALL ON SCHEMA "model_reservations" FROM PUBLIC;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC;

CREATE TABLE "model_reservations"."user" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL
);

CREATE TABLE "model_reservations"."resource" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  CONSTRAINT "uq_resource_name_unique" UNIQUE ("name")
);

CREATE TABLE "model_reservations"."reservation" (
  "id" uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "resource_id" uuid NOT NULL,
  "reserved_by_id" uuid NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  CONSTRAINT "ck_reservation_no_overlapping_reservations_valid_interval" CHECK (("starts_at" < "ends_at") IS TRUE),
  CONSTRAINT "ex_reservation_no_overlapping_reservations" EXCLUDE USING gist ("resource_id" WITH =, pg_catalog.tstzrange("starts_at", "ends_at", '[)') WITH &&)
);

ALTER TABLE "model_reservations"."reservation"
  ADD CONSTRAINT "fk_reservation_resource_id"
  FOREIGN KEY ("resource_id") REFERENCES "model_reservations"."resource" ("id");

ALTER TABLE "model_reservations"."reservation"
  ADD CONSTRAINT "fk_reservation_reserved_by_id"
  FOREIGN KEY ("reserved_by_id") REFERENCES "model_reservations"."user" ("id");

CREATE TABLE "model_reservations_internal"."principal_binding" (
  "database_principal" name PRIMARY KEY,
  "principal_id" uuid NOT NULL UNIQUE REFERENCES "model_reservations"."user" ("id")
);

CREATE TABLE "model_reservations_internal"."action_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "action_id" text NOT NULL,
  "database_principal" name NOT NULL,
  "principal_id" uuid NOT NULL,
  "target_id" uuid,
  "occurred_at" timestamptz NOT NULL DEFAULT transaction_timestamp()
);

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
CREATE OR REPLACE FUNCTION "model_reservations_internal"."resolve_principal_snapshot"()
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
      FROM "model_reservations_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id"
      FROM "model_reservations_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."resolve_principal_snapshot"() FROM PUBLIC;
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

CREATE TABLE "model_reservations_internal"."schema_migrations" (
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
INSERT INTO "model_reservations_internal"."schema_migrations" ("model_id", "version", "source_hash", "migration_kind")
VALUES ('model:Reservations', '0.20.0', 'sha256:295705d9572937a6f19897a1ec8da5453eee6dc8794a6802e70c22d982f6a4f1', 'installation');
RESET ROLE;

