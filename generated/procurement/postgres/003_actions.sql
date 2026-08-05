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
  VALUES ('model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_procurement_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_1e35db0451b1461e941af6283d86dca2' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2)))))::text);

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
  VALUES ('action:act_1e35db0451b1461e941af6283d86dca2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.41.0', 'sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44'), 'actionId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal", "publication_max_attempts", "publication_recovery_mode")
  VALUES ('model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'event:evt_10d694c9a0a274dc79c6168e47d25968', 'RequestOpened', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0, 5, 'manual');

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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

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
  VALUES ('action:act_ed2374e822704c51a2925338253d05d2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.41.0', 'sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44'), 'actionId', 'action:act_ed2374e822704c51a2925338253d05d2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_ed2374e822704c51a2925338253d05d2.is_draft', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal", "publication_max_attempts", "publication_recovery_mode")
  VALUES ('model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'event:evt_20d694c9a0a274dc79c6168e47d25968', 'RequestSubmitted', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_ed2374e822704c51a2925338253d05d2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0, 5, 'manual');

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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

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
  VALUES ('action:act_d39dbb883b5f4019b9027b85add3de47', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.41.0', 'sourceHash', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44'), 'actionId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal", "publication_max_attempts", "publication_recovery_mode")
  VALUES ('model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'event:evt_30d694c9a0a274dc79c6168e47d25968', 'RequestApproved', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_d39dbb883b5f4019b9027b85add3de47', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0, 5, 'manual');

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;

RESET ROLE;
