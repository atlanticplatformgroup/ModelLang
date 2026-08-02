-- Idempotent ModelLang 0.18 -> 0.19 reliable-command upgrade.
-- Historical audit rows remain correlation- and receipt-unknown; new reliable commands write complete receipts.
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
     OR v_version IS DISTINCT FROM '0.11.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418';
  END IF;
END
$modellang_upgrade$;
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
  VALUES ('model:Reservations', '0.11.0', 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418', 'action:act_508ad810a19d4b79a5009871de5cd26b', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_reservations_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_508ad810a19d4b79a5009871de5cd26b' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);

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
  VALUES ('action:act_508ad810a19d4b79a5009871de5cd26b', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Reservations', '0.11.0', 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Reservations', 'version', '0.11.0', 'sourceHash', 'sha256:1da8cdbda9f00f567d87c2757ebcad99692fecec78d7d2e853bd13a1d4b24418'), 'actionId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  UPDATE "model_reservations_internal"."command_receipt"
  SET "status" = 'executed', "response" = v_response, "target_id" = v_result."id",
      "action_audit_id" = v_action_audit_id, "completed_at" = pg_catalog.transaction_timestamp()
  WHERE "id" = v_receipt_id;

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;

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
