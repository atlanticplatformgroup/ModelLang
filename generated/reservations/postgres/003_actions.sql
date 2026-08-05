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
  VALUES ('model:Reservations', '0.42.0', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6', 'action:act_508ad810a19d4b79a5009871de5cd26b', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_reservations_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_508ad810a19d4b79a5009871de5cd26b' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);

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

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at", 'indexed', v_result."indexed");
  INSERT INTO "model_reservations_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_508ad810a19d4b79a5009871de5cd26b', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Reservations', '0.42.0', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Reservations', 'version', '0.42.0', 'sourceHash', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6'), 'actionId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_reservations_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal", "publication_max_attempts", "publication_recovery_mode")
  VALUES ('model:Reservations', '0.42.0', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6', 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'ReservationCreated', 'entity:ent_ba2d028e915841d1ab90adfa40d38404', 'action:act_508ad810a19d4b79a5009871de5cd26b', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0, 5, 'manual');

  UPDATE "model_reservations_internal"."command_receipt"
  SET "status" = 'executed', "response" = v_response, "target_id" = v_result."id",
      "action_audit_id" = v_action_audit_id, "completed_at" = pg_catalog.transaction_timestamp()
  WHERE "id" = v_receipt_id;

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;

RESET ROLE;
