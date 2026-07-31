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
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  IF NOT (("p_amount" <> 'NaN'::numeric AND pg_catalog.scale("p_amount") <= 2 AND pg_catalog.abs("p_amount") < 1000000000000000000) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount';
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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:c91f61fa1431e7e5f22a14dcfc4e06430a2134a2533c8150150dbc2a01f46f62', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb("p_amount"))))::text);
  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);

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

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject")
  VALUES ('action:act_1e35db0451b1461e941af6283d86dca2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject);

  RETURN jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
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
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:c91f61fa1431e7e5f22a14dcfc4e06430a2134a2533c8150150dbc2a01f46f62', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);
  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);

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

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject")
  VALUES ('action:act_ed2374e822704c51a2925338253d05d2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject);

  RETURN jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
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
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

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

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:c91f61fa1431e7e5f22a14dcfc4e06430a2134a2533c8150150dbc2a01f46f62', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);
  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles"))) OR ((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  IF NOT (((v_request."status" = 'SUBMITTED')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'APPROVED',
      "approved_by_id" = v_actor."id",
      "approved_by_roles" = v_actor."roles"
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject")
  VALUES ('action:act_d39dbb883b5f4019b9027b85add3de47', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject);

  RETURN jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;

RESET ROLE;
