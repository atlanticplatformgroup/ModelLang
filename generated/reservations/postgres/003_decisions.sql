-- Generated pure applicability queries. These decisions grant no execution authority.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"("p_resource" uuid, "p_starts_at" timestamptz, "p_ends_at" timestamptz, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_resource "model_reservations"."resource"%ROWTYPE;
  v_resource_xmin text;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_reservations_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource";

  SELECT row_value.xmin::text INTO v_resource_xmin
  FROM "model_reservations"."resource" AS row_value
  WHERE row_value."id" = "p_resource";

  SELECT * INTO v_actor
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_reservations"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:5bb8a030a1e8f9b56ab7059d652835cef72d1ba3fbb90a9cf156021401e31fb6', 'operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.resource', 'value', pg_catalog.to_jsonb("p_resource"), 'rowVersion', pg_catalog.to_jsonb(v_resource_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.startsAt', 'value', pg_catalog.to_jsonb("p_starts_at")), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_508ad810a19d4b79a5009871de5cd26b.endsAt', 'value', pg_catalog.to_jsonb("p_ends_at"))))::text);

  IF v_resource_xmin IS NULL OR v_actor_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_508ad810a19d4b79a5009871de5cd26b'));
  END IF;

  IF NOT ((("p_starts_at" < "p_ends_at")) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_508ad810a19d4b79a5009871de5cd26b.valid_interval'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_508ad810a19d4b79a5009871de5cd26b', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;

RESET ROLE;
