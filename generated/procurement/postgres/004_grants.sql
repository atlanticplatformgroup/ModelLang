-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_recovery;

REVOKE ALL ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery;
REVOKE ALL ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery;

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
REVOKE ALL ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"(jsonb) TO modellang_consumer;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher FROM modellang_consumer;
REVOKE modellang_consumer FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer FROM modellang_recovery;
REVOKE modellang_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;

