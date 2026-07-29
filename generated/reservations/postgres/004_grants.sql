-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;

GRANT SELECT ON TABLE "model_reservations"."user" TO modellang_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app;
GRANT SELECT ON TABLE "model_reservations"."resource" TO modellang_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app;
GRANT SELECT ON TABLE "model_reservations"."reservation" TO modellang_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, uuid, timestamptz, timestamptz) TO modellang_app;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;

