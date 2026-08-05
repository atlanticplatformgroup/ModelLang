-- Generated guarded query functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."reservations_for_resource"("p_resource" uuid, "p_starts_at_or_after" timestamptz, p_sort text DEFAULT NULL, p_cursor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result jsonb;
  v_sort_profile text;
  v_cursor_json jsonb;
  v_cursor_sort text;
  v_cursor_identity uuid;
  v_input_hash text;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_resource "model_reservations"."resource"%ROWTYPE;
BEGIN
  SELECT identity."principal_id"
  INTO v_principal_id
  FROM "model_reservations_internal"."resolve_principal"() AS identity;

  v_sort_profile := COALESCE(p_sort, 'default');
  IF v_sort_profile NOT IN ('default', 'latestFirst', 'endingSoonest') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:sort-profile:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
  END IF;

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
    'inputs', pg_catalog.jsonb_build_object('parameter:query:qry_94d8a56f4c2640fab58a4c2190c35c69.resource', pg_catalog.to_jsonb("p_resource"), 'parameter:query:qry_94d8a56f4c2640fab58a4c2190c35c69.startsAtOrAfter', pg_catalog.to_jsonb("p_starts_at_or_after"))
    , 'sortProfile', pg_catalog.to_jsonb(v_sort_profile)
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
      PERFORM CASE WHEN v_sort_profile = 'default' THEN (v_cursor_sort::timestamptz)::text WHEN v_sort_profile = 'latestFirst' THEN (v_cursor_sort::timestamptz)::text WHEN v_sort_profile = 'endingSoonest' THEN (v_cursor_sort::timestamptz)::text END;
      v_cursor_identity := (v_cursor_json ->> 'identity')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:cursor:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
    END;

    IF v_cursor_json ->> 'modelId' IS DISTINCT FROM 'model:Reservations'
      OR v_cursor_json ->> 'modelVersion' IS DISTINCT FROM '0.41.0'
      OR v_cursor_json ->> 'sourceHash' IS DISTINCT FROM 'sha256:55dd4e3cf827daa3a2b9cb0613d7bb0ed0d3bd4137ad88699f791b79fd5b1c0d'
      OR v_cursor_json ->> 'queryId' IS DISTINCT FROM 'query:qry_94d8a56f4c2640fab58a4c2190c35c69'
      OR v_cursor_json ->> 'revision' IS DISTINCT FROM 'sha256:23312df0fdb9b20a5017fc04c6d33d8c36a15cba50996185e419265746099d9a'
      OR v_cursor_json ->> 'orderFieldId' IS DISTINCT FROM (CASE WHEN v_sort_profile = 'default' THEN 'field:fld_59e1f90fae57481f921c5a81dfd3a234' WHEN v_sort_profile = 'latestFirst' THEN 'field:fld_59e1f90fae57481f921c5a81dfd3a234' WHEN v_sort_profile = 'endingSoonest' THEN 'field:fld_fd818707952f4b388baea4c3132bce63' END)
      OR v_cursor_json ->> 'direction' IS DISTINCT FROM (CASE WHEN v_sort_profile = 'default' THEN 'asc' WHEN v_sort_profile = 'latestFirst' THEN 'desc' WHEN v_sort_profile = 'endingSoonest' THEN 'asc' END)
      OR v_cursor_json ->> 'inputHash' IS DISTINCT FROM v_input_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:cursor:query:qry_94d8a56f4c2640fab58a4c2190c35c69';
    END IF;
  END IF;

  WITH page_rows AS MATERIALIZED (
    SELECT jsonb_build_object('id', v_row."id", 'resource', (SELECT jsonb_build_object('id', "v_projection_1"."id", 'name', "v_projection_1"."name") FROM "model_reservations"."resource" AS "v_projection_1" WHERE "v_projection_1"."id" = v_row."resource_id"), 'startsAt', v_row."starts_at", 'endsAt', v_row."ends_at") AS "item",
           CASE WHEN v_sort_profile = 'default' THEN (v_row."starts_at")::text WHEN v_sort_profile = 'latestFirst' THEN (v_row."starts_at")::text WHEN v_sort_profile = 'endingSoonest' THEN (v_row."ends_at")::text END AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_reservations"."reservation" AS v_row
    WHERE ((((v_row."resource_id" = v_resource."id") AND (("p_starts_at_or_after" IS NULL) OR (v_row."starts_at" >= "p_starts_at_or_after")))) IS TRUE)
      AND (p_cursor IS NULL
        OR ((v_sort_profile = 'default' AND (v_row."starts_at" > v_cursor_sort::timestamptz OR (v_row."starts_at" = v_cursor_sort::timestamptz AND v_row."id" > v_cursor_identity))) OR (v_sort_profile = 'latestFirst' AND (v_row."starts_at" < v_cursor_sort::timestamptz OR (v_row."starts_at" = v_cursor_sort::timestamptz AND v_row."id" > v_cursor_identity))) OR (v_sort_profile = 'endingSoonest' AND (v_row."ends_at" > v_cursor_sort::timestamptz OR (v_row."ends_at" = v_cursor_sort::timestamptz AND v_row."id" > v_cursor_identity)))))
    ORDER BY CASE WHEN v_sort_profile = 'default' THEN v_row."starts_at" END ASC, CASE WHEN v_sort_profile = 'latestFirst' THEN v_row."starts_at" END DESC, CASE WHEN v_sort_profile = 'endingSoonest' THEN v_row."ends_at" END ASC, v_row."id" ASC
    LIMIT 3
  ), visible_rows AS MATERIALIZED (
    SELECT * FROM page_rows
    ORDER BY CASE WHEN v_sort_profile = 'default' THEN page_rows."sort_value"::timestamptz END ASC, CASE WHEN v_sort_profile = 'latestFirst' THEN page_rows."sort_value"::timestamptz END DESC, CASE WHEN v_sort_profile = 'endingSoonest' THEN page_rows."sort_value"::timestamptz END ASC, page_rows."identity" ASC
    LIMIT 2
  )
  SELECT pg_catalog.jsonb_build_object(
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg("item" ORDER BY CASE WHEN v_sort_profile = 'default' THEN visible_rows."sort_value"::timestamptz END ASC, CASE WHEN v_sort_profile = 'latestFirst' THEN visible_rows."sort_value"::timestamptz END DESC, CASE WHEN v_sort_profile = 'endingSoonest' THEN visible_rows."sort_value"::timestamptz END ASC, visible_rows."identity" ASC)
      FROM visible_rows
    ), '[]'::jsonb),
    'nextCursor', CASE WHEN (SELECT pg_catalog.count(*) FROM page_rows) > 2 THEN (
      SELECT pg_catalog.rtrim(pg_catalog.translate(pg_catalog.replace(pg_catalog.encode(pg_catalog.convert_to((pg_catalog.jsonb_build_object('v', 1, 'modelId', 'model:Reservations', 'modelVersion', '0.41.0', 'sourceHash', 'sha256:55dd4e3cf827daa3a2b9cb0613d7bb0ed0d3bd4137ad88699f791b79fd5b1c0d', 'queryId', 'query:qry_94d8a56f4c2640fab58a4c2190c35c69', 'revision', 'sha256:23312df0fdb9b20a5017fc04c6d33d8c36a15cba50996185e419265746099d9a', 'orderFieldId', (CASE WHEN v_sort_profile = 'default' THEN 'field:fld_59e1f90fae57481f921c5a81dfd3a234' WHEN v_sort_profile = 'latestFirst' THEN 'field:fld_59e1f90fae57481f921c5a81dfd3a234' WHEN v_sort_profile = 'endingSoonest' THEN 'field:fld_fd818707952f4b388baea4c3132bce63' END), 'direction', (CASE WHEN v_sort_profile = 'default' THEN 'asc' WHEN v_sort_profile = 'latestFirst' THEN 'desc' WHEN v_sort_profile = 'endingSoonest' THEN 'asc' END), 'inputHash', v_input_hash, 'sort', ("sort_value")::text, 'identity', ("identity")::text))::text, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')
      FROM visible_rows
      ORDER BY CASE WHEN v_sort_profile = 'default' THEN visible_rows."sort_value"::timestamptz END DESC, CASE WHEN v_sort_profile = 'latestFirst' THEN visible_rows."sort_value"::timestamptz END ASC, CASE WHEN v_sort_profile = 'endingSoonest' THEN visible_rows."sort_value"::timestamptz END DESC, visible_rows."identity" DESC
      LIMIT 1
    ) ELSE NULL END
  ) INTO v_result;

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, timestamptz, text, text) FROM PUBLIC;

RESET ROLE;
