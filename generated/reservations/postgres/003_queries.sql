-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."reservations_for_resource"("p_resource" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_resource "model_reservations"."resource"%ROWTYPE;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_reservations_internal"."resolve_principal"() AS identity;

  SELECT * INTO v_actor
  FROM "model_reservations"."user"
  WHERE "id" = v_principal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource"
  WHERE "id" = "p_resource";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(v_query."item" ORDER BY v_query."sort_value" ASC, v_query."identity" ASC),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object('id', v_row."id", 'resource', v_row."resource_id", 'startsAt', v_row."starts_at", 'endsAt', v_row."ends_at") AS "item",
           v_row."starts_at" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_reservations"."reservation" AS v_row
    WHERE (((v_row."resource_id" = v_resource."id")) IS TRUE)
    ORDER BY v_row."starts_at" ASC, v_row."id" ASC
    LIMIT 100
  ) AS v_query;

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;

RESET ROLE;
