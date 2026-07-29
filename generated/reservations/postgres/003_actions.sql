-- Generated guarded action functions. Caller identity is always session_user.
SET ROLE modellang_owner;

CREATE FUNCTION "model_reservations"."reserve"("p_id" uuid, "p_resource" uuid, "p_starts_at" timestamptz, "p_ends_at" timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_result "model_reservations"."reservation"%ROWTYPE;
  v_actor "model_reservations"."user"%ROWTYPE;
  v_resource "model_reservations"."resource"%ROWTYPE;
BEGIN
  SELECT "principal_id" INTO v_principal_id
  FROM "model_reservations_internal"."principal_binding"
  WHERE "database_principal" = session_user
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;

  PERFORM "id" FROM "model_reservations"."resource"
  WHERE "id" = ANY (ARRAY["p_resource"]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_reservations"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  SELECT * INTO v_resource
  FROM "model_reservations"."resource"
  WHERE "id" = "p_resource"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:resource';
  END IF;

  SELECT * INTO v_actor
  FROM "model_reservations"."user"
  WHERE "id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ML_NOT_FOUND:actor';
  END IF;

  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:reserve';
  END IF;

  IF NOT ((("p_starts_at" < "p_ends_at")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:reserve.valid_interval';
  END IF;

  INSERT INTO "model_reservations"."reservation" ("id", "resource_id", "reserved_by_id", "starts_at", "ends_at")
  VALUES ("p_id", v_resource."id", v_actor."id", "p_starts_at", "p_ends_at")
  RETURNING * INTO v_result;

  INSERT INTO "model_reservations_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id")
  VALUES ('action:reserve', session_user, v_principal_id, v_result."id");

  RETURN jsonb_build_object('id', v_result."id", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at");
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;

RESET ROLE;
