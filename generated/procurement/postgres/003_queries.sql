-- Generated guarded query functions. Caller identity is always session_user.
SET ROLE modellang_owner;

CREATE FUNCTION "model_procurement"."my_requests"()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_actor "model_procurement"."user"%ROWTYPE;
BEGIN
  SELECT "principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."principal_binding"
  WHERE "database_principal" = session_user
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;

  SELECT * INTO v_actor
  FROM "model_procurement"."user"
  WHERE "id" = v_principal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:actor';
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:myRequests';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(v_query."item" ORDER BY v_query."sort_value" ASC, v_query."identity" ASC),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object('id', v_row."id", 'requester', v_row."requester_id", 'amount', v_row."amount"::text, 'status', v_row."status", 'approvedBy', v_row."approved_by_id", 'approvedByRole', v_row."approved_by_role") AS "item",
           v_row."id" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_procurement"."purchase_request" AS v_row
    WHERE (((v_row."requester_id" = v_actor."id")) IS TRUE)
    ORDER BY v_row."id" ASC, v_row."id" ASC
    LIMIT 100
  ) AS v_query;

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."my_requests"() FROM PUBLIC;

RESET ROLE;
