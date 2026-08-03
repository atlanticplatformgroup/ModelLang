-- Idempotent ModelLang 0.35 -> 0.36 private transactional read-evidence upgrade.
-- No historical reads or evidence are fabricated; only newly committed opted-in query executions append evidence.
BEGIN;
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
     OR v_version IS DISTINCT FROM '0.36.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:3a8a6deb0d90bda63e43f30c7d5598d48f59c08f1f56b4e51c8c4df8b35d58fc' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:3a8a6deb0d90bda63e43f30c7d5598d48f59c08f1f56b4e51c8c4df8b35d58fc';
  END IF;
END
$modellang_upgrade$;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."runtime_profile" (
  "singleton" boolean PRIMARY KEY DEFAULT TRUE,
  "profile_version" integer NOT NULL,
  CONSTRAINT "ck_runtime_profile_singleton" CHECK ("singleton"),
  CONSTRAINT "ck_runtime_profile_version" CHECK ("profile_version" >= 0)
);
LOCK TABLE "model_procurement_internal"."runtime_profile" IN EXCLUSIVE MODE;
DO $modellang_runtime_profile$
DECLARE
  v_profile_version integer;
BEGIN
  SELECT "profile_version" INTO v_profile_version
  FROM "model_procurement_internal"."runtime_profile" WHERE "singleton" FOR UPDATE;
  IF FOUND AND v_profile_version > 36 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_RUNTIME_PROFILE_DOWNGRADE:36:' || v_profile_version;
  END IF;
END
$modellang_runtime_profile$;
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
INSERT INTO "model_procurement_internal"."runtime_profile" ("singleton", "profile_version")
VALUES (TRUE, 36)
ON CONFLICT ("singleton") DO UPDATE
SET "profile_version" = GREATEST("model_procurement_internal"."runtime_profile"."profile_version", EXCLUDED."profile_version");
RESET ROLE;

-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."my_requests"()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_identity_issuer text;
  v_identity_subject text;
  v_actor "model_procurement"."user"%ROWTYPE;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  SELECT * INTO v_actor
  FROM "model_procurement"."user"
  WHERE "id" = v_principal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_4406b045404a48449282db804f6167a8';
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_4406b045404a48449282db804f6167a8';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(v_query."item" ORDER BY v_query."sort_value" ASC, v_query."identity" ASC),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object('id', v_row."id", 'createdAt', v_row."created_at", 'amount', CASE WHEN (((v_row."status" <> 'DRAFT')) IS TRUE) THEN jsonb_build_object('currency', 'USD', 'amount', (v_row."amount"::numeric(20, 2))::text) ELSE NULL END, 'status', v_row."status", 'approvedBy', CASE WHEN v_row."approved_by_id" IS NULL THEN NULL ELSE (SELECT jsonb_build_object('id', "v_projection_4"."id", 'name', "v_projection_4"."name") FROM "model_procurement"."user" AS "v_projection_4" WHERE "v_projection_4"."id" = v_row."approved_by_id") END) AS "item",
           v_row."id" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_procurement"."purchase_request" AS v_row
    WHERE (((v_row."requester_id" = v_actor."id")) IS TRUE)
    ORDER BY v_row."id" ASC, v_row."id" ASC
    LIMIT 100
  ) AS v_query;

  INSERT INTO "model_procurement_internal"."query_audit" ("query_id", "database_principal", "principal_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "query_revision", "request_hash", "response_hash", "result_count", "sort_profile", "continued")
  VALUES ('query:qry_4406b045404a48449282db804f6167a8', session_user, v_principal_id, v_identity_issuer, v_identity_subject, 'model:Procurement', '0.36.0', 'sha256:3a8a6deb0d90bda63e43f30c7d5598d48f59c08f1f56b4e51c8c4df8b35d58fc', 'sha256:f232c790851adcfb9b1395335cb412593c83f92ca199f3bc29f832074c4511c7', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object('queryId', 'query:qry_4406b045404a48449282db804f6167a8', 'revision', 'sha256:f232c790851adcfb9b1395335cb412593c83f92ca199f3bc29f832074c4511c7', 'inputs', pg_catalog.jsonb_build_object(), 'sortProfile', pg_catalog.to_jsonb('default'::text)))::text, 'UTF8')), 'hex'), 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((v_result)::text, 'UTF8')), 'hex'), pg_catalog.jsonb_array_length(v_result), 'default', FALSE);

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."my_requests"() FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_recovery;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_publication_recovery;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_failure_observer;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_failure_acknowledger;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_failure_claimant;

REVOKE ALL ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;

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
REVOKE ALL ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."fail_event"(uuid, uuid, text) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) TO modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."observe_terminal_consumers"(timestamptz, timestamptz, text, uuid, integer) TO modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."acknowledge_terminal_publication_failure"(uuid, text) TO modellang_failure_acknowledger;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."acknowledge_terminal_consumer_failure"(text, text, text) TO modellang_failure_acknowledger;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_terminal_publication_failure"(uuid) TO modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_terminal_consumer_failure"(text, text) TO modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;

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
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer FROM modellang_failure_acknowledger;
REVOKE modellang_failure_acknowledger FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger FROM modellang_failure_claimant;
REVOKE modellang_failure_claimant FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
