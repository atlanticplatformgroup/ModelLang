-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_reservations" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT USAGE ON SCHEMA "model_reservations" TO modellang_app;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_consumer;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_publication_recovery;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_failure_observer;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_failure_acknowledger;
GRANT USAGE ON SCHEMA "model_reservations_internal" TO modellang_failure_claimant;

REVOKE ALL ON TABLE "model_reservations"."user" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON TABLE "model_reservations"."resource" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON TABLE "model_reservations"."reservation" FROM PUBLIC, modellang_app, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;

REVOKE ALL ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reserve"(uuid, timestamptz, timestamptz) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."decide_act_508ad810a19d4b79a5009871de5cd26b"(uuid, timestamptz, timestamptz, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "model_reservations"."reservations_for_resource"(uuid, timestamptz, text, text) TO modellang_app;
REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;
REVOKE ALL ON ALL TABLES IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_reservations_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher, modellang_consumer, modellang_recovery, modellang_publication_recovery, modellang_failure_observer, modellang_failure_acknowledger, modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."fail_event"(uuid, uuid, text) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consumer_failure_state"(text, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."record_consumer_failure"(text, text, integer, text) TO modellang_consumer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_consumer_failure"(text, text, text) TO modellang_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) TO modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."observe_terminal_consumers"(timestamptz, timestamptz, text, uuid, integer) TO modellang_failure_observer;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."acknowledge_terminal_publication_failure"(uuid, text) TO modellang_failure_acknowledger;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."acknowledge_terminal_consumer_failure"(text, text, text) TO modellang_failure_acknowledger;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_terminal_publication_failure"(uuid) TO modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."claim_terminal_consumer_failure"(text, text) TO modellang_failure_claimant;
GRANT EXECUTE ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) TO modellang_consumer;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
DO $modellang$
DECLARE
  v_granted_role text;
  v_member_role text;
BEGIN
  FOR v_granted_role, v_member_role IN
    SELECT granted_role.rolname::text, member_role.rolname::text
    FROM (VALUES
      ('modellang_owner', 'modellang_app'),
      ('modellang_owner', 'modellang_gateway'),
      ('modellang_gateway', 'modellang_app'),
      ('modellang_owner', 'modellang_dispatcher'),
      ('modellang_app', 'modellang_dispatcher'),
      ('modellang_gateway', 'modellang_dispatcher'),
      ('modellang_dispatcher', 'modellang_owner'),
      ('modellang_dispatcher', 'modellang_app'),
      ('modellang_dispatcher', 'modellang_gateway'),
      ('modellang_owner', 'modellang_consumer'),
      ('modellang_app', 'modellang_consumer'),
      ('modellang_gateway', 'modellang_consumer'),
      ('modellang_dispatcher', 'modellang_consumer'),
      ('modellang_consumer', 'modellang_owner'),
      ('modellang_consumer', 'modellang_app'),
      ('modellang_consumer', 'modellang_gateway'),
      ('modellang_consumer', 'modellang_dispatcher'),
      ('modellang_owner', 'modellang_recovery'),
      ('modellang_app', 'modellang_recovery'),
      ('modellang_gateway', 'modellang_recovery'),
      ('modellang_dispatcher', 'modellang_recovery'),
      ('modellang_consumer', 'modellang_recovery'),
      ('modellang_recovery', 'modellang_owner'),
      ('modellang_recovery', 'modellang_app'),
      ('modellang_recovery', 'modellang_gateway'),
      ('modellang_recovery', 'modellang_dispatcher'),
      ('modellang_recovery', 'modellang_consumer'),
      ('modellang_owner', 'modellang_publication_recovery'),
      ('modellang_app', 'modellang_publication_recovery'),
      ('modellang_gateway', 'modellang_publication_recovery'),
      ('modellang_dispatcher', 'modellang_publication_recovery'),
      ('modellang_consumer', 'modellang_publication_recovery'),
      ('modellang_recovery', 'modellang_publication_recovery'),
      ('modellang_publication_recovery', 'modellang_owner'),
      ('modellang_publication_recovery', 'modellang_app'),
      ('modellang_publication_recovery', 'modellang_gateway'),
      ('modellang_publication_recovery', 'modellang_dispatcher'),
      ('modellang_publication_recovery', 'modellang_consumer'),
      ('modellang_publication_recovery', 'modellang_recovery'),
      ('modellang_owner', 'modellang_failure_observer'),
      ('modellang_app', 'modellang_failure_observer'),
      ('modellang_gateway', 'modellang_failure_observer'),
      ('modellang_dispatcher', 'modellang_failure_observer'),
      ('modellang_consumer', 'modellang_failure_observer'),
      ('modellang_recovery', 'modellang_failure_observer'),
      ('modellang_publication_recovery', 'modellang_failure_observer'),
      ('modellang_failure_observer', 'modellang_owner'),
      ('modellang_failure_observer', 'modellang_app'),
      ('modellang_failure_observer', 'modellang_gateway'),
      ('modellang_failure_observer', 'modellang_dispatcher'),
      ('modellang_failure_observer', 'modellang_consumer'),
      ('modellang_failure_observer', 'modellang_recovery'),
      ('modellang_failure_observer', 'modellang_publication_recovery'),
      ('modellang_owner', 'modellang_failure_acknowledger'),
      ('modellang_app', 'modellang_failure_acknowledger'),
      ('modellang_gateway', 'modellang_failure_acknowledger'),
      ('modellang_dispatcher', 'modellang_failure_acknowledger'),
      ('modellang_consumer', 'modellang_failure_acknowledger'),
      ('modellang_recovery', 'modellang_failure_acknowledger'),
      ('modellang_publication_recovery', 'modellang_failure_acknowledger'),
      ('modellang_failure_observer', 'modellang_failure_acknowledger'),
      ('modellang_failure_acknowledger', 'modellang_owner'),
      ('modellang_failure_acknowledger', 'modellang_app'),
      ('modellang_failure_acknowledger', 'modellang_gateway'),
      ('modellang_failure_acknowledger', 'modellang_dispatcher'),
      ('modellang_failure_acknowledger', 'modellang_consumer'),
      ('modellang_failure_acknowledger', 'modellang_recovery'),
      ('modellang_failure_acknowledger', 'modellang_publication_recovery'),
      ('modellang_failure_acknowledger', 'modellang_failure_observer'),
      ('modellang_owner', 'modellang_failure_claimant'),
      ('modellang_app', 'modellang_failure_claimant'),
      ('modellang_gateway', 'modellang_failure_claimant'),
      ('modellang_dispatcher', 'modellang_failure_claimant'),
      ('modellang_consumer', 'modellang_failure_claimant'),
      ('modellang_recovery', 'modellang_failure_claimant'),
      ('modellang_publication_recovery', 'modellang_failure_claimant'),
      ('modellang_failure_observer', 'modellang_failure_claimant'),
      ('modellang_failure_acknowledger', 'modellang_failure_claimant'),
      ('modellang_failure_claimant', 'modellang_owner'),
      ('modellang_failure_claimant', 'modellang_app'),
      ('modellang_failure_claimant', 'modellang_gateway'),
      ('modellang_failure_claimant', 'modellang_dispatcher'),
      ('modellang_failure_claimant', 'modellang_consumer'),
      ('modellang_failure_claimant', 'modellang_recovery'),
      ('modellang_failure_claimant', 'modellang_publication_recovery'),
      ('modellang_failure_claimant', 'modellang_failure_observer'),
      ('modellang_failure_claimant', 'modellang_failure_acknowledger')
    ) AS candidate(granted_role, member_role)
    JOIN pg_catalog.pg_roles AS granted_role ON granted_role.rolname = candidate.granted_role
    JOIN pg_catalog.pg_roles AS member_role ON member_role.rolname = candidate.member_role
    JOIN pg_catalog.pg_auth_members AS membership
      ON membership.roleid = granted_role.oid AND membership.member = member_role.oid
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', v_granted_role, v_member_role);
  END LOOP;
END
$modellang$;
GRANT modellang_app TO modellang_gateway;

