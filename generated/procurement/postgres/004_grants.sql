-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app, modellang_gateway;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_gateway;

REVOKE ALL ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app;
REVOKE ALL ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."open_request"(numeric) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."submit_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."submit_request"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."approve_request"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_procurement"."my_requests"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_procurement"."my_requests"() TO modellang_app;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;

