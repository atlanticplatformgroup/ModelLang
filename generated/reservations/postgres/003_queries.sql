-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."reservations_for_resource"("p_resource" uuid, p_cursor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_cursor_json jsonb;
  v_cursor_sort "model_reservations"."reservation"."starts_at"%TYPE;
  v_cursor_identity uuid;
  v_input_hash text;
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

  v_input_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
    'caller', pg_catalog.to_jsonb(v_principal_id),
    'inputs', pg_catalog.jsonb_build_object('parameter:query:qry_94d8a56f4c2640fab58a4c2190c35c69.resource', pg_catalog.to_jsonb("p_resource"))
  ))::text, 'UTF8')), 'hex');

  IF p_cursor IS NOT NULL THEN
    BEGIN
      IF pg_catalog.length(p_cursor) < 1 OR pg_catalog.length(p_cursor) > 4096 OR p_cursor !~ '^[A-Za-z0-9_-]+$' THEN
        RAISE EXCEPTION 'invalid cursor';
      END IF;
      v_cursor_json := pg_catalog.convert_from(
        pg_catalog.decode(pg_catalog.translate(p_cursor, '-_', '+/') || pg_catalog.repeat('=', (4 - pg_catalog.length(p_cursor) % 4) % 4), 'base64'),
        'UTF8'
      )::jsonb;
      IF pg_catalog.jsonb_typeof(v_cursor_json) IS DISTINCT FROM 'object'
        OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_cursor_json)) <> 11
        OR (v_cursor_json -> 'v') IS DISTINCT FROM '1'::jsonb
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'modelId') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'modelVersion') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'sourceHash') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'queryId') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'revision') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'orderFieldId') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'direction') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'inputHash') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'sort') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_cursor_json -> 'identity') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid cursor';
      END IF;
      v_cursor_sort := v_cursor_json ->> 'sort';
      v_cursor_identity := (v_cursor_json ->> 'identity')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:cursor:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
    END;

    IF v_cursor_json ->> 'modelId' IS DISTINCT FROM 'model:Reservations'
      OR v_cursor_json ->> 'modelVersion' IS DISTINCT FROM '0.32.0'
      OR v_cursor_json ->> 'sourceHash' IS DISTINCT FROM 'sha256:e243751bc4fee67af88f8e21ab8d17c0bde7094fbe1dcba38937a735a1a483ea'
      OR v_cursor_json ->> 'queryId' IS DISTINCT FROM 'query:qry_94d8a56f4c2640fab58a4c2190c35c69'
      OR v_cursor_json ->> 'revision' IS DISTINCT FROM 'sha256:2ffa9d79ab03bcc20551480edf7b6c3541cd2ed70c69b934677a63673d59fad2'
      OR v_cursor_json ->> 'orderFieldId' IS DISTINCT FROM 'field:fld_59e1f90fae57481f921c5a81dfd3a234'
      OR v_cursor_json ->> 'direction' IS DISTINCT FROM 'asc'
      OR v_cursor_json ->> 'inputHash' IS DISTINCT FROM v_input_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:cursor:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
    END IF;
  END IF;

  WITH page_rows AS MATERIALIZED (
    SELECT jsonb_build_object('id', v_row."id", 'resource', (SELECT jsonb_build_object('id', "v_projection_1"."id", 'name', "v_projection_1"."name") FROM "model_reservations"."resource" AS "v_projection_1" WHERE "v_projection_1"."id" = v_row."resource_id"), 'startsAt', v_row."starts_at", 'endsAt', v_row."ends_at") AS "item",
           v_row."starts_at" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_reservations"."reservation" AS v_row
    WHERE (((v_row."resource_id" = v_resource."id")) IS TRUE)
      AND (p_cursor IS NULL
        OR v_row."starts_at" > v_cursor_sort
        OR (v_row."starts_at" = v_cursor_sort AND v_row."id" > v_cursor_identity))
    ORDER BY v_row."starts_at" ASC, v_row."id" ASC
    LIMIT 3
  ), visible_rows AS MATERIALIZED (
    SELECT * FROM page_rows
    ORDER BY "sort_value" ASC, "identity" ASC
    LIMIT 2
  )
  SELECT pg_catalog.jsonb_build_object(
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg("item" ORDER BY "sort_value" ASC, "identity" ASC)
      FROM visible_rows
    ), '[]'::jsonb),
    'nextCursor', CASE WHEN (SELECT pg_catalog.count(*) FROM page_rows) > 2 THEN (
      SELECT pg_catalog.rtrim(pg_catalog.translate(pg_catalog.replace(pg_catalog.encode(pg_catalog.convert_to((pg_catalog.jsonb_build_object('v', 1, 'modelId', 'model:Reservations', 'modelVersion', '0.32.0', 'sourceHash', 'sha256:e243751bc4fee67af88f8e21ab8d17c0bde7094fbe1dcba38937a735a1a483ea', 'queryId', 'query:qry_94d8a56f4c2640fab58a4c2190c35c69', 'revision', 'sha256:2ffa9d79ab03bcc20551480edf7b6c3541cd2ed70c69b934677a63673d59fad2', 'orderFieldId', 'field:fld_59e1f90fae57481f921c5a81dfd3a234', 'direction', 'asc', 'inputHash', v_input_hash, 'sort', ("sort_value")::text, 'identity', ("identity")::text))::text, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')
      FROM visible_rows
      ORDER BY "sort_value" DESC, "identity" DESC
      LIMIT 1
    ) ELSE NULL END
  ) INTO v_result;

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, text) FROM PUBLIC;

RESET ROLE;
