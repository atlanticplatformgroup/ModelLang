-- Generated private transactional event consumers. Broker transport remains host-owned.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_reservations_internal"."consume_index_reservation"(p_envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
DECLARE
  v_source_event_id uuid;
  v_target_id uuid;
  v_source_model_id text;
  v_source_model_version text;
  v_source_hash text;
  v_envelope_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_delivery_attempt integer;
  v_correlation_id text;
  v_causation_id text;
  v_payload_json jsonb;
  v_envelope_keys text[];
  v_payload_keys text[];
  v_inbox_id bigint;
  v_consumer_audit_id bigint;
  v_authority_policy_id text;
  v_authority_id text;
  v_response jsonb;
  v_payload "model_reservations"."reservation"%ROWTYPE;
  v_result "model_reservations"."reservation"%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS consumer_role ON consumer_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE consumer_role.rolname = 'modellang_consumer' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_REQUIRED';
  END IF;
  IF p_envelope IS NULL OR pg_catalog.jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_envelope_keys FROM pg_catalog.jsonb_object_keys(p_envelope) AS key_name;
  IF v_envelope_keys IS NOT DISTINCT FROM ARRAY['actionId', 'causationId', 'correlationId', 'deliveryAttempt', 'eventId', 'eventName', 'id', 'modelId', 'modelVersion', 'occurredAt', 'ordinal', 'payload', 'sourceHash', 'targetId']::text[] THEN
    p_envelope := p_envelope || pg_catalog.jsonb_build_object('consumerId', NULL);
  ELSIF v_envelope_keys IS DISTINCT FROM ARRAY['actionId', 'causationId', 'consumerId', 'correlationId', 'deliveryAttempt', 'eventId', 'eventName', 'id', 'modelId', 'modelVersion', 'occurredAt', 'ordinal', 'payload', 'sourceHash', 'targetId']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  IF pg_catalog.jsonb_typeof(p_envelope->'id') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'eventName') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'modelVersion') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'sourceHash') IS DISTINCT FROM 'string'
     OR (p_envelope->'actionId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'actionId') IS DISTINCT FROM 'string')
     OR (p_envelope->'consumerId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'consumerId') IS DISTINCT FROM 'string')
     OR pg_catalog.jsonb_typeof(p_envelope->'targetId') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'payload') IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_envelope->'correlationId') IS DISTINCT FROM 'string'
     OR (p_envelope->'causationId' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(p_envelope->'causationId') IS DISTINCT FROM 'string')
     OR pg_catalog.jsonb_typeof(p_envelope->'occurredAt') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(p_envelope->'ordinal') IS DISTINCT FROM 'number'
     OR pg_catalog.jsonb_typeof(p_envelope->'deliveryAttempt') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END IF;
  BEGIN
    v_source_event_id := (p_envelope->>'id')::uuid;
    v_target_id := (p_envelope->>'targetId')::uuid;
    v_delivery_attempt := (p_envelope->>'deliveryAttempt')::integer;
    PERFORM (p_envelope->>'occurredAt')::timestamptz, (p_envelope->>'ordinal')::integer;
  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_ENVELOPE';
  END;
  v_source_model_id := p_envelope->>'modelId';
  v_source_model_version := p_envelope->>'modelVersion';
  v_source_hash := p_envelope->>'sourceHash';
  v_correlation_id := p_envelope->>'correlationId';
  v_causation_id := p_envelope->>'causationId';
  v_payload_json := p_envelope->'payload';
  IF p_envelope->>'eventId' IS DISTINCT FROM 'event:evt_40d694c9a0a274dc79c6168e47d25968'
     OR p_envelope->>'eventName' IS DISTINCT FROM 'ReservationCreated'
     OR v_source_model_id IS DISTINCT FROM 'model:Reservations'
     OR v_source_model_version IS DISTINCT FROM '0.22.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:4734c3fc4c4486ee33c643c1d76fd68984d2883c1555f1469a54a97b3368e046'
     OR NOT ((((p_envelope->>'actionId') IS NOT NULL AND (p_envelope->>'actionId' ~ '^action:.+$') AND p_envelope->'consumerId' = 'null'::jsonb)
              OR (p_envelope->'actionId' = 'null'::jsonb AND (p_envelope->>'consumerId') IS NOT NULL AND (p_envelope->>'consumerId' ~ '^consumer:.+$'))) IS TRUE)
     OR (p_envelope->>'ordinal')::integer < 0
     OR v_delivery_attempt < 1
     OR v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_CONTRACT';
  END IF;
  v_envelope_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(((p_envelope - 'deliveryAttempt'))::text, 'UTF8')), 'hex');
  INSERT INTO "model_reservations_internal"."event_inbox" ("consumer_id", "source_event_id", "source_event_type", "source_event_name", "source_model_id", "source_model_version", "source_hash", "envelope_hash", "payload", "correlation_id", "causation_id", "first_delivery_attempt", "last_delivery_attempt")
  VALUES ('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'ReservationCreated', v_source_model_id, v_source_model_version, v_source_hash, v_envelope_hash, v_payload_json, v_correlation_id, v_causation_id, v_delivery_attempt, v_delivery_attempt)
  ON CONFLICT ("consumer_id", "source_event_id") DO NOTHING RETURNING "id" INTO v_inbox_id;
  IF v_inbox_id IS NULL THEN
    SELECT "envelope_hash", "status", "response" INTO v_existing_hash, v_existing_status, v_existing_response
    FROM "model_reservations_internal"."event_inbox" WHERE "consumer_id" = 'consumer:con_20d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id FOR UPDATE;
    IF v_existing_hash IS DISTINCT FROM v_envelope_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_EVENT_CONFLICT';
    END IF;
    IF v_existing_status IS DISTINCT FROM 'executed' OR v_existing_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_EVENT_INCOMPLETE';
    END IF;
    UPDATE "model_reservations_internal"."event_inbox" SET "last_delivery_attempt" = GREATEST("last_delivery_attempt", v_delivery_attempt) WHERE "consumer_id" = 'consumer:con_20d694c9a0a274dc79c6168e47d25968' AND "source_event_id" = v_source_event_id;
    RETURN v_existing_response;
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT pg_catalog.array_agg(key_name ORDER BY key_name) INTO v_payload_keys FROM pg_catalog.jsonb_object_keys(v_payload_json) AS key_name;
  IF v_payload_keys IS DISTINCT FROM ARRAY['createdAt', 'endsAt', 'id', 'indexed', 'reservedBy', 'resource', 'startsAt']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'id') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'createdAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'resource') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'reservedBy') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'startsAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'endsAt') = 'string') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  IF NOT ((pg_catalog.jsonb_typeof(v_payload_json->'indexed') = 'boolean') IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  BEGIN
    SELECT (v_payload_json->'id'#>>'{}')::uuid, (v_payload_json->'createdAt'#>>'{}')::timestamptz, (v_payload_json->'resource'#>>'{}')::uuid, (v_payload_json->'reservedBy'#>>'{}')::uuid, (v_payload_json->'startsAt'#>>'{}')::timestamptz, (v_payload_json->'endsAt'#>>'{}')::timestamptz, (v_payload_json->'indexed'#>>'{}')::boolean
    INTO v_payload;
  EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END;
  IF v_payload.id IS DISTINCT FROM v_target_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_EVENT_PAYLOAD';
  END IF;
  SELECT * INTO v_result FROM "model_reservations"."reservation" WHERE "id" = v_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_TARGET'; END IF;
  IF NOT ((TRUE) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_CONSUMER_AUTHORIZATION:authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968';
  END IF;
  IF NOT (((v_payload."starts_at" < v_payload."ends_at")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_CONSUMER_PRECONDITION:require:consumer:con_20d694c9a0a274dc79c6168e47d25968.valid_interval';
  END IF;
  UPDATE "model_reservations"."reservation" SET "indexed" = TRUE WHERE "id" = v_target_id RETURNING * INTO v_result;
  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'resource', v_result."resource_id", 'reservedBy', v_result."reserved_by_id", 'startsAt', v_result."starts_at", 'endsAt', v_result."ends_at", 'indexed', v_result."indexed");
  INSERT INTO "model_reservations_internal"."consumer_audit" ("consumer_id", "source_event_id", "source_event_type", "source_model_id", "source_model_version", "source_hash", "target_id", "authorization_rule_id", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id")
  VALUES ('consumer:con_20d694c9a0a274dc79c6168e47d25968', v_source_event_id, 'event:evt_40d694c9a0a274dc79c6168e47d25968', v_source_model_id, v_source_model_version, v_source_hash, v_result."id", 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 1, 'outcome', 'consumed', 'consumerId', 'consumer:con_20d694c9a0a274dc79c6168e47d25968', 'sourceEventId', v_source_event_id, 'sourceContract', pg_catalog.jsonb_build_object('eventId', 'event:evt_40d694c9a0a274dc79c6168e47d25968', 'modelId', v_source_model_id, 'modelVersion', v_source_model_version, 'sourceHash', v_source_hash), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:consumer:con_20d694c9a0a274dc79c6168e47d25968', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:consumer:con_20d694c9a0a274dc79c6168e47d25968.valid_interval', 'outcome', 'passed')), 'emittedEventIds', pg_catalog.to_jsonb(ARRAY['event:evt_60d694c9a0a274dc79c6168e47d25968']::text[])), v_correlation_id, v_causation_id) RETURNING "id" INTO v_consumer_audit_id;
  INSERT INTO "model_reservations_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "consumer_id", "target_id", "payload", "correlation_id", "causation_id", "consumer_audit_id", "ordinal")
  VALUES ('model:Reservations', '0.22.0', 'sha256:4734c3fc4c4486ee33c643c1d76fd68984d2883c1555f1469a54a97b3368e046', 'event:evt_60d694c9a0a274dc79c6168e47d25968', 'ReservationIndexed', 'entity:ent_ba2d028e915841d1ab90adfa40d38404', 'consumer:con_20d694c9a0a274dc79c6168e47d25968', v_result."id", v_response, v_correlation_id, v_source_event_id::text, v_consumer_audit_id, 0);

  UPDATE "model_reservations_internal"."event_inbox" SET "status" = 'executed', "target_id" = v_result."id", "response" = v_response, "consumer_audit_id" = v_consumer_audit_id, "completed_at" = pg_catalog.transaction_timestamp() WHERE "id" = v_inbox_id;
  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_reservations_internal"."consume_index_reservation"(jsonb) FROM PUBLIC;

RESET ROLE;
