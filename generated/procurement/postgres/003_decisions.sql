-- Generated pure applicability queries. These decisions grant no execution authority.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"("p_amount" numeric, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  IF NOT (("p_amount" <> 'NaN'::numeric AND pg_catalog.scale("p_amount") <= 2 AND pg_catalog.abs("p_amount") < 1000000000000000000) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount';
  END IF;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:51281cba2655f2b2854d464aba904c05f2277fb86fba8b50d7174e4fc4703fe5', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2)))))::text);

  IF v_actor_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF NOT ((((('EMPLOYEE' = ANY(v_actor."roles")) OR ('MANAGER' = ANY(v_actor."roles"))) OR ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF NOT ((("p_amount" > 0)) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"("p_request" uuid, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:51281cba2655f2b2854d464aba904c05f2277fb86fba8b50d7174e4fc4703fe5', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF v_actor_xmin IS NULL OR v_request_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF NOT (((v_actor."id" = v_request."requester_id")) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF NOT (((v_request."status" = 'DRAFT')) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_ed2374e822704c51a2925338253d05d2.is_draft'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"("p_request" uuid, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:51281cba2655f2b2854d464aba904c05f2277fb86fba8b50d7174e4fc4703fe5', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF v_actor_xmin IS NULL OR v_request_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END) + (CASE WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END)) = 1))) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF NOT (((v_request."status" = 'SUBMITTED')) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) FROM PUBLIC;

RESET ROLE;
