-- source sha256:d198253cc61f662997e38107cd468f196669d7a2099391b409fe6baf85ce4a4f
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
  "id" uuid NOT NULL PRIMARY KEY,
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
RESET ROLE;

