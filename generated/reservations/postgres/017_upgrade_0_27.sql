-- Idempotent ModelLang 0.26 -> 0.27 private terminal-failure observation upgrade.
-- Existing failure state is unchanged and no historical observation audit is fabricated.
BEGIN;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_failure_observer') THEN
    CREATE ROLE modellang_failure_observer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_failure_observer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery FROM modellang_failure_observer;
REVOKE modellang_failure_observer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
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
     OR v_version IS DISTINCT FROM '0.33.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:378ebe0315d1a0182c2ef1a61a6ce6f8f8260dd3e038d6fea2adf7c42ed3b4f9' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:378ebe0315d1a0182c2ef1a61a6ce6f8f8260dd3e038d6fea2adf7c42ed3b4f9';
  END IF;
END
$modellang_upgrade$;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."runtime_profile" (
  "singleton" boolean PRIMARY KEY DEFAULT TRUE,
  "profile_version" integer NOT NULL,
  CONSTRAINT "ck_runtime_profile_singleton" CHECK ("singleton"),
  CONSTRAINT "ck_runtime_profile_version" CHECK ("profile_version" >= 0)
);
LOCK TABLE "model_reservations_internal"."runtime_profile" IN EXCLUSIVE MODE;
DO $modellang_runtime_profile$
DECLARE
  v_profile_version integer;
BEGIN
  SELECT "profile_version" INTO v_profile_version
  FROM "model_reservations_internal"."runtime_profile" WHERE "singleton" FOR UPDATE;
  IF FOUND AND v_profile_version > 27 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_RUNTIME_PROFILE_DOWNGRADE:27:' || v_profile_version;
  END IF;
END
$modellang_runtime_profile$;
CREATE TABLE IF NOT EXISTS "model_reservations_internal"."failure_observation_audit" (
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
CREATE INDEX IF NOT EXISTS "ix_event_outbox_terminal_observation" ON "model_reservations_internal"."event_outbox" ("publication_terminal_at", "id") WHERE "publication_disposition" = 'deadLetter';
CREATE INDEX IF NOT EXISTS "ix_consumer_failure_terminal_observation" ON "model_reservations_internal"."consumer_failure" ("terminal_at", "consumer_id", "source_event_id") WHERE "disposition" = 'deadLetter';
CREATE OR REPLACE FUNCTION "model_reservations_internal"."observe_terminal_publications"(p_snapshot_at timestamptz, p_after_terminal_at timestamptz, p_after_event_id uuid, p_limit integer) RETURNS jsonb
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
      row_value."publication_recovery_mode" = 'manual' AS recovery_eligible
    FROM "model_reservations_internal"."event_outbox" AS row_value
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
      'recoveryEligible', recovery_eligible) ORDER BY terminal_at, event_instance_id) FROM page_rows), '[]'::jsonb),
    'nextCursor', CASE WHEN stats.candidate_count > p_limit THEN (SELECT pg_catalog.jsonb_build_object(
      'snapshotAt', v_snapshot_at, 'afterTerminalAt', terminal_at, 'afterEventInstanceId', event_instance_id)
      FROM page_rows ORDER BY terminal_at DESC, event_instance_id DESC LIMIT 1) ELSE NULL END)
  INTO v_result FROM stats;
  INSERT INTO "model_reservations_internal"."failure_observation_audit" ("database_principal", "failure_kind", "snapshot_at", "after_terminal_at", "after_identity", "requested_limit", "returned_count", "has_more")
  VALUES (session_user, 'publication', v_snapshot_at, p_after_terminal_at, p_after_event_id::text, p_limit, pg_catalog.jsonb_array_length(v_result->'items'), v_result->'nextCursor' <> 'null'::jsonb);
  RETURN v_result;
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."observe_terminal_consumers"(p_snapshot_at timestamptz, p_after_terminal_at timestamptz, p_after_consumer_id text, p_after_event_id uuid, p_limit integer) RETURNS jsonb
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
      row_value."consumer_id" IN ('consumer:con_20d694c9a0a274dc79c6168e47d25968') AS recovery_eligible
    FROM "model_reservations_internal"."consumer_failure" AS row_value
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
      'recoveryEligible', recovery_eligible) ORDER BY terminal_at, consumer_id, event_instance_id) FROM page_rows), '[]'::jsonb),
    'nextCursor', CASE WHEN stats.candidate_count > p_limit THEN (SELECT pg_catalog.jsonb_build_object(
      'snapshotAt', v_snapshot_at, 'afterTerminalAt', terminal_at, 'afterConsumerId', consumer_id, 'afterEventInstanceId', event_instance_id)
      FROM page_rows ORDER BY terminal_at DESC, consumer_id DESC, event_instance_id DESC LIMIT 1) ELSE NULL END)
  INTO v_result FROM stats;
  INSERT INTO "model_reservations_internal"."failure_observation_audit" ("database_principal", "failure_kind", "snapshot_at", "after_terminal_at", "after_identity", "requested_limit", "returned_count", "has_more")
  VALUES (session_user, 'consumer', v_snapshot_at, p_after_terminal_at, CASE WHEN p_after_consumer_id IS NULL THEN NULL ELSE p_after_consumer_id || ':' || p_after_event_id::text END, p_limit, pg_catalog.jsonb_array_length(v_result->'items'), v_result->'nextCursor' <> 'null'::jsonb);
  RETURN v_result;
END $modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."observe_terminal_consumers"(timestamptz, timestamptz, text, uuid, integer) FROM PUBLIC;
INSERT INTO "model_reservations_internal"."runtime_profile" ("singleton", "profile_version")
VALUES (TRUE, 27)
ON CONFLICT ("singleton") DO UPDATE
SET "profile_version" = GREATEST("model_reservations_internal"."runtime_profile"."profile_version", EXCLUDED."profile_version");
RESET ROLE;

-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_publication_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_failure_observer;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."fail_event"(uuid, uuid, text) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) TO modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."observe_terminal_consumers"(timestamptz, timestamptz, text, uuid, integer) TO modellang_failure_observer;
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
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery FROM modellang_failure_observer;
REVOKE modellang_failure_observer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
