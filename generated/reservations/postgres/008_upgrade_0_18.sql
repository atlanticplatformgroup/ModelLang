-- Idempotent ModelLang 0.17 -> 0.18 durable decision-evidence upgrade.
-- Historical action audit rows remain explicitly evidence-unknown; new executions record complete evidence.
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
  FROM "model_reservations_internal"."schema_migrations"
  ORDER BY "id" DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM 'model:Reservations'
     OR v_version IS DISTINCT FROM '0.10.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215';
  END IF;
END
$modellang_upgrade$;
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
RESET ROLE;

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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);
  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);

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

  INSERT INTO "model_reservations_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence")
  VALUES ('action:act_508ad810a19d4b79a5009871de5cd26b', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Reservations', '0.10.0', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 1, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Reservations', 'version', '0.10.0', 'sourceHash', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215'), 'actionId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))));

  RETURN jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at");
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;

RESET ROLE;
-- Generated pure applicability queries. These decisions grant no execution authority.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"("p_resource" uuid, "p_starts_at" timestamptz, "p_ends_at" timestamptz, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_resource "model_reservations"."resource"%ROWTYPE;
  v_resource_xmin text;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_reservations_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource";

  SELECT row_value.xmin::text INTO v_resource_xmin
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource";

  SELECT * INTO v_actor
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);

  IF v_resource_xmin IS NULL OR v_actor_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF NOT ((("p_starts_at" < "p_ends_at")) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) TO modellang_app;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
