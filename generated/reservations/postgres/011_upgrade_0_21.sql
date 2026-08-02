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
     OR v_version IS DISTINCT FROM '0.21.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:acfcc04418f2754a0d7f0bb1af546e8d082e2cf2ee8f00c86b4bf7f330d4c5ca' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:acfcc04418f2754a0d7f0bb1af546e8d082e2cf2ee8f00c86b4bf7f330d4c5ca';
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
  "last_delivery_attempt" integer NOT NULL,
  "last_error_code" text NOT NULL,
  "last_failed_at" timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY ("consumer_id", "source_event_id"),
  CONSTRAINT "ck_consumer_failure_count" CHECK ("failure_count" >= 1 AND "last_delivery_attempt" >= 1),
  CONSTRAINT "ck_consumer_failure_code" CHECK ("last_error_code" ~ '^ML_[A-Z_]+$')
);
CREATE OR REPLACE FUNCTION "model_reservations_internal"."record_consumer_failure"(p_consumer_id text, p_event_id text, p_delivery_attempt integer, p_error_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
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
  INSERT INTO "model_reservations_internal"."consumer_failure" ("consumer_id", "source_event_id", "last_delivery_attempt", "last_error_code")
  VALUES (p_consumer_id, p_event_id, p_delivery_attempt, p_error_code)
  ON CONFLICT ("consumer_id", "source_event_id") DO UPDATE SET
    "failure_count" = "model_reservations_internal"."consumer_failure"."failure_count" + 1,
    "last_delivery_attempt" = GREATEST("model_reservations_internal"."consumer_failure"."last_delivery_attempt", EXCLUDED."last_delivery_attempt"),
    "last_error_code" = EXCLUDED."last_error_code", "last_failed_at" = pg_catalog.clock_timestamp();
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) FROM PUBLIC;
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
  IF v_envelope_keys IS DISTINCT FROM ARRAY['actionId', 'causationId', 'correlationId', 'deliveryAttempt', 'eventId', 'eventName', 'id', 'modelId', 'modelVersion', 'occurredAt', 'ordinal', 'payload', 'sourceHash', 'targetId']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  IF pg_catalog.jsonb_typeof(p_envelope->'id') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventName') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelVersion') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'sourceHash') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'actionId') IS DISTINCT FROM 'string'
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
     OR v_source_model_version IS DISTINCT FROM '0.21.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:acfcc04418f2754a0d7f0bb1af546e8d082e2cf2ee8f00c86b4bf7f330d4c5ca'
     OR p_envelope->>'actionId' !~ '^action:.+$'
     OR (p_envelope->>'ordinal')::integer < 0
     OR v_delivery_attempt < 1
     OR v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_CONTRACT';
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
  VALUES ('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_40d694c9a0a274dc79c6168e47d25968', v_source_model_id, v_source_model_version, v_source_hash, v_result."id", 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 1, 'outcome', 'consumed', 'consumerId', 'consumer:con_20d694c9a0a274dc79c6168e47d25968', 'sourceEventId', v_source_event_id, 'sourceContract', pg_catalog.jsonb_build_object('eventId', 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'modelId', v_source_model_id, 'modelVersion', v_source_model_version, 'sourceHash', v_source_hash), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:consumer:con_20d694c9a0a274dc79c6168e47d25968.valid_interval', 'outcome', 'passed'))), v_correlation_id, v_causation_id) RETURNING "id" INTO v_consumer_audit_id;
  UPDATE "model_reservations_internal"."event_inbox" SET "status" = 'executed', "target_id" = v_result."id", "response" = v_response, "consumer_audit_id" = v_consumer_audit_id, "completed_at" = pg_catalog.transaction_timestamp() WHERE "id" = v_inbox_id;
  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_consumer;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;

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
