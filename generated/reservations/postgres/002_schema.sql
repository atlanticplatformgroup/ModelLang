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

CREATE TABLE "model_reservations_internal"."schema_migrations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_id" text NOT NULL,
  "version" text NOT NULL UNIQUE,
  "source_hash" text NOT NULL UNIQUE,
  "applied_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()
);
INSERT INTO "model_reservations_internal"."schema_migrations" ("model_id", "version", "source_hash")
VALUES ('model:Reservations', '0.10.0', 'sha256:16abeadf4f4eceba16f786d649dc64c49a7e4bfd8cd5f7fdc59e2795fd7bd215');
RESET ROLE;

