-- Generated guarded action functions. Caller identity is always session_user.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."open_request"("p_id" uuid, "p_amount" numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
BEGIN
  SELECT "principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."principal_binding"
  WHERE "database_principal" = session_user
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user"
  WHERE "id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:actor';
  END IF;

  IF NOT ((((('EMPLOYEE' = ANY(v_actor."roles")) OR ('MANAGER' = ANY(v_actor."roles"))) OR ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF NOT ((("p_amount" > 0)) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount';
  END IF;

  INSERT INTO "model_procurement"."purchase_request" ("id", "requester_id", "amount", "status", "approved_by_id", "approved_by_roles")
  VALUES ("p_id", v_actor."id", "p_amount", 'DRAFT', NULL, NULL)
  RETURNING * INTO v_result;

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id")
  VALUES ('action:act_1e35db0451b1461e941af6283d86dca2', session_user, v_principal_id, v_result."id");

  RETURN jsonb_build_object('id', v_result."id", 'requester', v_result."requester_id", 'amount', v_result."amount"::text, 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(uuid, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."submit_request"("p_request" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
BEGIN
  SELECT "principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."principal_binding"
  WHERE "database_principal" = session_user
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user"
  WHERE "id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:actor';
  END IF;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request"
  WHERE "id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:request';
  END IF;

  IF NOT (((v_actor."id" = v_request."requester_id")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  IF NOT (((v_request."status" = 'DRAFT')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_ed2374e822704c51a2925338253d05d2.is_draft';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'SUBMITTED'
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id")
  VALUES ('action:act_ed2374e822704c51a2925338253d05d2', session_user, v_principal_id, v_result."id");

  RETURN jsonb_build_object('id', v_result."id", 'requester', v_result."requester_id", 'amount', v_result."amount"::text, 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
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
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
BEGIN
  SELECT "principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."principal_binding"
  WHERE "database_principal" = session_user
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user"
  WHERE "id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:actor';
  END IF;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request"
  WHERE "id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:request';
  END IF;

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles"))) OR ((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
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

  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id")
  VALUES ('action:act_d39dbb883b5f4019b9027b85add3de47', session_user, v_principal_id, v_result."id");

  RETURN jsonb_build_object('id', v_result."id", 'requester', v_result."requester_id", 'amount', v_result."amount"::text, 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;

RESET ROLE;
