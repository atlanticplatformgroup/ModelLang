-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;

GRANT SELECT ON TABLE "model_procurement"."user" TO modellang_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app;
GRANT SELECT ON TABLE "model_procurement"."purchase_request" TO modellang_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."open_request"(uuid, numeric) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."submit_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."submit_request"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."approve_request"(uuid) TO modellang_app;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;

