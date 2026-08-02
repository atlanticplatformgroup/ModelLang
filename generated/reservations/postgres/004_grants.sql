-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_publication_recovery;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery, modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."fail_event"(uuid, uuid, text) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;

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
REVOKE modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery FROM modellang_publication_recovery;
REVOKE modellang_publication_recovery FROM modellang_owner, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;

