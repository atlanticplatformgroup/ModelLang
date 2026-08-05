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
  v_identity_issuer text;
  v_identity_subject text;
  v_actor "model_procurement"."user"%ROWTYPE;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
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
    SELECT jsonb_build_object('id', v_row."id", 'createdAt', v_row."created_at", 'amount', CASE WHEN (((v_row."status" <> 'DRAFT')) IS TRUE) THEN jsonb_build_object('currency', 'USD', 'amount', (v_row."amount"::numeric(20, 2))::text) ELSE NULL END, 'status', v_row."status", 'approvedBy', CASE WHEN v_row."approved_by_id" IS NULL THEN NULL ELSE (SELECT jsonb_build_object('id', "v_projection_4"."id", 'name', "v_projection_4"."name") FROM "model_procurement"."user" AS "v_projection_4" WHERE "v_projection_4"."id" = v_row."approved_by_id") END) AS "item",
           v_row."id" AS "sort_value",
           v_row."id" AS "identity"
    FROM "model_procurement"."purchase_request" AS v_row
    WHERE (((v_row."requester_id" = v_actor."id")) IS TRUE)
    ORDER BY v_row."id" ASC, v_row."id" ASC
    LIMIT 100
  ) AS v_query;

  INSERT INTO "model_procurement_internal"."query_audit" ("query_id", "database_principal", "principal_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "query_revision", "request_hash", "response_hash", "result_count", "sort_profile", "continued")
  VALUES ('query:qry_4406b045404a48449282db804f6167a8', session_user, v_principal_id, v_identity_issuer, v_identity_subject, 'model:Procurement', '0.41.0', 'sha256:b4bcdbda1196182f0c0815aebd832183bf2c520d8604dbe88f544fe2e6a17f44', 'sha256:f232c790851adcfb9b1395335cb412593c83f92ca199f3bc29f832074c4511c7', 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object('queryId', 'query:qry_4406b045404a48449282db804f6167a8', 'revision', 'sha256:f232c790851adcfb9b1395335cb412593c83f92ca199f3bc29f832074c4511c7', 'inputs', pg_catalog.jsonb_build_object(), 'sortProfile', pg_catalog.to_jsonb('default'::text)))::text, 'UTF8')), 'hex'), 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((v_result)::text, 'UTF8')), 'hex'), pg_catalog.jsonb_array_length(v_result), 'default', FALSE);

  RETURN v_result;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."my_requests"() FROM PUBLIC;

RESET ROLE;
