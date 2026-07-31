-- source sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA "model_reservations" AUTHORIZATION modellang_owner;
CREATE SCHEMA "model_reservations_internal" AUTHORIZATION modellang_owner;
SET ROLE modellang_owner;
REVOKE ALL ON SCHEMA "model_reservations" FROM PUBLIC;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC;

CREATE TABLE "model_reservations"."user" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL
);

CREATE TABLE "model_reservations"."resource" (
  "id" uuid NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  CONSTRAINT "uq_resource_name_unique" UNIQUE ("name")
);

CREATE TABLE "model_reservations"."reservation" (
  "id" uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "resource_id" uuid NOT NULL,
  "reserved_by_id" uuid NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  CONSTRAINT "ck_reservation_no_overlapping_reservations_valid_interval" CHECK (("starts_at" < "ends_at") IS TRUE),
  CONSTRAINT "ex_reservation_no_overlapping_reservations" EXCLUDE USING gist ("resource_id" WITH =, pg_catalog.tstzrange("starts_at", "ends_at", '[)') WITH &&)
);

ALTER TABLE "model_reservations"."reservation"
  ADD CONSTRAINT "fk_reservation_resource_id"
  FOREIGN KEY ("resource_id") REFERENCES "model_reservations"."resource" ("id");

ALTER TABLE "model_reservations"."reservation"
  ADD CONSTRAINT "fk_reservation_reserved_by_id"
  FOREIGN KEY ("reserved_by_id") REFERENCES "model_reservations"."user" ("id");

CREATE TABLE "model_reservations_internal"."principal_binding" (
  "database_principal" name PRIMARY KEY,
  "principal_id" uuid NOT NULL UNIQUE REFERENCES "model_reservations"."user" ("id")
);

CREATE TABLE "model_reservations_internal"."action_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "action_id" text NOT NULL,
  "database_principal" name NOT NULL,
  "principal_id" uuid NOT NULL,
  "target_id" uuid,
  "occurred_at" timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE IF NOT EXISTS "model_reservations_internal"."gateway_principal_binding" (
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "principal_id" uuid NOT NULL REFERENCES "model_reservations"."user" ("id"),
  PRIMARY KEY ("issuer", "subject"),
  CONSTRAINT "ck_gateway_principal_binding_identity" CHECK (
    pg_catalog.char_length("issuer") BETWEEN 1 AND 512
    AND pg_catalog.char_length("subject") BETWEEN 1 AND 512
  )
);
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_issuer" text;
ALTER TABLE "model_reservations_internal"."action_audit" ADD COLUMN IF NOT EXISTS "identity_subject" text;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_reservations_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_gateway_identity'
  ) THEN
    ALTER TABLE "model_reservations_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_gateway_identity"
      CHECK (("identity_issuer" IS NULL) = ("identity_subject" IS NULL));
  END IF;
END
$modellang$;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."bind_gateway_identity"(p_issuer text, p_subject text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_GATEWAY_REQUIRED';
  END IF;
  IF p_issuer IS NULL OR pg_catalog.char_length(p_issuer) NOT BETWEEN 1 AND 512
     OR p_subject IS NULL OR pg_catalog.char_length(p_subject) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:gateway_identity';
  END IF;
  PERFORM 1 FROM "model_reservations_internal"."gateway_principal_binding" AS binding
  WHERE binding."issuer" = p_issuer AND binding."subject" = p_subject
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
  PERFORM pg_catalog.set_config('modellang.gateway_issuer', p_issuer, true);
  PERFORM pg_catalog.set_config('modellang.gateway_subject', p_subject, true);
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."resolve_principal"()
RETURNS TABLE ("principal_id" uuid, "identity_issuer" text, "identity_subject" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_issuer text;
  v_subject text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);
    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);
    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
    END IF;
    RETURN QUERY
      SELECT binding."principal_id", binding."issuer", binding."subject"
      FROM "model_reservations_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject
      FOR SHARE;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id", NULL::text, NULL::text
      FROM "model_reservations_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user
      FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."resolve_principal"() FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_reservations_internal"."resolve_principal_snapshot"()
RETURNS TABLE ("principal_id" uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_issuer text;
  v_subject text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS gateway_role ON gateway_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE gateway_role.rolname = 'modellang_gateway' AND identity_role.rolname = session_user
  ) THEN
    v_issuer := pg_catalog.current_setting('modellang.gateway_issuer', true);
    v_subject := pg_catalog.current_setting('modellang.gateway_subject', true);
    IF v_issuer IS NULL OR v_issuer = '' OR v_subject IS NULL OR v_subject = '' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
    END IF;
    RETURN QUERY
      SELECT binding."principal_id"
      FROM "model_reservations_internal"."gateway_principal_binding" AS binding
      WHERE binding."issuer" = v_issuer AND binding."subject" = v_subject;
  ELSE
    RETURN QUERY
      SELECT binding."principal_id"
      FROM "model_reservations_internal"."principal_binding" AS binding
      WHERE binding."database_principal" = session_user;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_IDENTITY_UNBOUND';
  END IF;
END
$modellang$;
REVOKE ALL ON FUNCTION "model_reservations_internal"."resolve_principal_snapshot"() FROM PUBLIC;

CREATE TABLE "model_reservations_internal"."schema_migrations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_id" text NOT NULL,
  "version" text NOT NULL UNIQUE,
  "source_hash" text NOT NULL UNIQUE,
  "migration_kind" text NOT NULL,
  "plan_hash" text,
  CONSTRAINT "ck_schema_migrations_kind" CHECK ("migration_kind" IN ('installation', 'safe', 'reviewed')),
  CONSTRAINT "ck_schema_migrations_reviewed_plan" CHECK (
    (("migration_kind" = 'reviewed') = ("plan_hash" IS NOT NULL))
    AND ("plan_hash" IS NULL OR "plan_hash" ~ '^sha256:[0-9a-f]{64}$')
  ),
  "applied_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
INSERT INTO "model_reservations_internal"."schema_migrations" ("model_id", "version", "source_hash", "migration_kind")
VALUES ('model:Reservations', '0.10.0', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215', 'installation');
RESET ROLE;

