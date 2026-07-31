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
  v_actor "model_procurement"."user"%ROWTYPE;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
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
    SELECT jsonb_build_object('id', v_row."id", 'createdAt', v_row."created_at", 'requester', v_row."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_row."amount"::numeric(20, 2))::text), 'status', v_row."status", 'approvedBy', v_row."approved_by_id", 'approvedByRoles', v_row."approved_by_roles") AS "item",
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
