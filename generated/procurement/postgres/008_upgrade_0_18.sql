-- Idempotent ModelLang 0.17 -> 0.18 durable decision-evidence upgrade.
-- Historical action audit rows remain explicitly evidence-unknown; new executions record complete evidence.
BEGIN;
DO $modellang$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'modellang_dispatcher') THEN
    CREATE ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$modellang$;

ALTER ROLE modellang_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
SET LOCAL ROLE modellang_owner;
DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT "model_id", "version", "source_hash"
  INTO v_model_id, v_version, v_source_hash
  FROM "model_procurement_internal"."schema_migrations"
  ORDER BY "id" DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM 'model:Procurement'
     OR v_version IS DISTINCT FROM '0.20.0'
     OR v_source_hash IS DISTINCT FROM 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4';
  END IF;
END
$modellang_upgrade$;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "model_version" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "source_hash" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authorization_rule_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_outcome" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "policy_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "authority_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "decision_evidence" jsonb;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass
      AND conname = 'ck_action_audit_decision_evidence'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_decision_evidence" CHECK (
      ("decision_evidence" IS NULL
       AND "model_id" IS NULL AND "model_version" IS NULL
       AND "source_hash" IS NULL AND "authorization_rule_id" IS NULL
       AND "decision_outcome" IS NULL AND "policy_id" IS NULL AND "authority_id" IS NULL)
      OR
      ("decision_evidence" IS NOT NULL
       AND "model_id" IS NOT NULL AND "model_version" IS NOT NULL
       AND "source_hash" ~ '^sha256:[0-9a-f]{64}$'
       AND "authorization_rule_id" IS NOT NULL AND "decision_outcome" = 'executed'
       AND (("policy_id" IS NULL) = ("authority_id" IS NULL)))
    );
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."command_receipt" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "action_id" text NOT NULL,
  "principal_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "status" text NOT NULL DEFAULT 'executing',
  "response" jsonb,
  "target_id" uuid,
  "action_audit_id" bigint UNIQUE REFERENCES "model_procurement_internal"."action_audit" ("id"),
  "created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "completed_at" timestamptz,
  CONSTRAINT "uq_command_receipt_identity" UNIQUE ("principal_id", "action_id", "idempotency_key"),
  CONSTRAINT "ck_command_receipt_hashes" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$' AND "request_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_command_receipt_ids" CHECK ("idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND "correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_command_receipt_completion" CHECK (
    ("status" = 'executing' AND "response" IS NULL AND "target_id" IS NULL AND "action_audit_id" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'executed' AND "response" IS NOT NULL AND "target_id" IS NOT NULL AND "action_audit_id" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "correlation_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "causation_id" text;
ALTER TABLE "model_procurement_internal"."action_audit" ADD COLUMN IF NOT EXISTS "command_receipt_id" bigint;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_action_audit_command_receipt" ON "model_procurement_internal"."action_audit" ("command_receipt_id") WHERE "command_receipt_id" IS NOT NULL;
DO $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass AND conname = 'fk_action_audit_command_receipt'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "fk_action_audit_command_receipt" FOREIGN KEY ("command_receipt_id") REFERENCES "model_procurement_internal"."command_receipt" ("id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = '"model_procurement_internal"."action_audit"'::regclass AND conname = 'ck_action_audit_command_metadata'
  ) THEN
    ALTER TABLE "model_procurement_internal"."action_audit" ADD CONSTRAINT "ck_action_audit_command_metadata" CHECK (
      ("correlation_id" IS NULL AND "causation_id" IS NULL AND "command_receipt_id" IS NULL)
      OR ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'))
    );
  END IF;
END
$modellang$;
CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "source_hash" text NOT NULL,
  "event_id" text NOT NULL,
  "event_name" text NOT NULL,
  "payload_entity_id" text NOT NULL,
  "action_id" text NOT NULL,
  "principal_id" uuid NOT NULL,
  "target_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "causation_id" text,
  "action_audit_id" bigint NOT NULL REFERENCES "model_procurement_internal"."action_audit" ("id"),
  "command_receipt_id" bigint REFERENCES "model_procurement_internal"."command_receipt" ("id"),
  "ordinal" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  "delivery_attempts" integer NOT NULL DEFAULT 0,
  "lease_token" uuid,
  "leased_until" timestamptz,
  "published_at" timestamptz,
  CONSTRAINT "uq_event_outbox_action_ordinal" UNIQUE ("action_audit_id", "ordinal"),
  CONSTRAINT "ck_event_outbox_hash" CHECK ("source_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "ck_event_outbox_metadata" CHECK ("correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND ("causation_id" IS NULL OR "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')),
  CONSTRAINT "ck_event_outbox_delivery" CHECK ("delivery_attempts" >= 0 AND (("lease_token" IS NULL) = ("leased_until" IS NULL)) AND ("published_at" IS NULL OR ("lease_token" IS NULL AND "leased_until" IS NULL)))
);
CREATE INDEX IF NOT EXISTS "ix_event_outbox_delivery" ON "model_procurement_internal"."event_outbox" ("occurred_at", "action_audit_id", "ordinal", "id") WHERE "published_at" IS NULL;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_events"(p_limit integer, p_lease_seconds integer)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_lease_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:boundary:event_outbox';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT row_value."id" FROM "model_procurement_internal"."event_outbox" AS row_value
    WHERE row_value."published_at" IS NULL AND (row_value."leased_until" IS NULL OR row_value."leased_until" <= pg_catalog.clock_timestamp())
    ORDER BY row_value."occurred_at", row_value."action_audit_id", row_value."ordinal", row_value."id"
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), leased AS (
    UPDATE "model_procurement_internal"."event_outbox" AS row_value SET "lease_token" = v_lease_token,
      "leased_until" = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      "delivery_attempts" = row_value."delivery_attempts" + 1
    FROM candidates WHERE row_value."id" = candidates."id" RETURNING row_value.*
  )
  SELECT pg_catalog.jsonb_build_object('id', "id", 'eventId', "event_id", 'eventName', "event_name",
    'modelId', "model_id", 'modelVersion', "model_version", 'sourceHash', "source_hash", 'actionId', "action_id",
    'targetId', "target_id", 'payload', "payload", 'correlationId', "correlation_id",
    'causationId', "causation_id", 'occurredAt', "occurred_at", 'ordinal', "ordinal", 'deliveryAttempt', "delivery_attempts", 'leaseToken', "lease_token")
  FROM leased ORDER BY "occurred_at", "action_audit_id", "ordinal", "id";
END
$modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."ack_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  UPDATE "model_procurement_internal"."event_outbox" SET "published_at" = pg_catalog.clock_timestamp(), "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token AND "leased_until" > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION "model_procurement_internal"."release_event"(p_event_id uuid, p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $modellang$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS dispatcher_role ON dispatcher_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS identity_role ON identity_role.oid = membership.member
    WHERE dispatcher_role.rolname = 'modellang_dispatcher' AND identity_role.rolname = session_user
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_DISPATCHER_REQUIRED';
  END IF;
  UPDATE "model_procurement_internal"."event_outbox" SET "lease_token" = (NULL::uuid), "leased_until" = (NULL::timestamptz)
  WHERE "id" = p_event_id AND "published_at" IS NULL AND "lease_token" = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_OUTBOX_LEASE'; END IF;
END $modellang$;
REVOKE ALL ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) FROM PUBLIC;
RESET ROLE;

-- Generated guarded action functions. Caller identity is resolved from direct login or transaction-bound gateway context.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."open_request"("p_amount" numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_REQUIRED:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, v_idempotency_key);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
     OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF NOT (("p_amount" <> 'NaN'::numeric AND pg_catalog.scale("p_amount") <= 2 AND pg_catalog.abs("p_amount") < 1000000000000000000) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount';
  END IF;

  v_request_hash := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.jsonb_build_object('actionId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'inputs', pg_catalog.jsonb_build_object('parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2))), 'expectedRevision', v_expected_revision, 'correlationId', v_correlation_id, 'causationId', v_causation_id))::text, 'UTF8')), 'hex');
  INSERT INTO "model_procurement_internal"."command_receipt" ("model_id", "model_version", "source_hash", "action_id", "principal_id", "idempotency_key", "request_hash", "correlation_id", "causation_id")
  VALUES ('model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_idempotency_key, v_request_hash, v_correlation_id, v_causation_id)
  ON CONFLICT ("principal_id", "action_id", "idempotency_key") DO NOTHING
  RETURNING "id" INTO v_receipt_id;

  IF v_receipt_id IS NULL THEN
    SELECT "id", "source_hash", "request_hash", "status", "response"
    INTO v_receipt_id, v_receipt_source_hash, v_receipt_request_hash, v_receipt_status, v_receipt_response
    FROM "model_procurement_internal"."command_receipt"
    WHERE "principal_id" = v_principal_id AND "action_id" = 'action:act_1e35db0451b1461e941af6283d86dca2' AND "idempotency_key" = v_idempotency_key;
    IF v_receipt_source_hash IS DISTINCT FROM 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4' OR v_receipt_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_IDEMPOTENCY_CONFLICT:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
    END IF;
    IF v_receipt_status IS DISTINCT FROM 'executed' OR v_receipt_response IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_IDEMPOTENCY_INCOMPLETE:idempotency:action:act_1e35db0451b1461e941af6283d86dca2';
    END IF;
    RETURN v_receipt_response;
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2)))))::text);

  IF NOT ((((('EMPLOYEE' = ANY(v_actor."roles")) OR ('MANAGER' = ANY(v_actor."roles"))) OR ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_1e35db0451b1461e941af6283d86dca2';
  END IF;

  IF NOT ((("p_amount" > 0)) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount';
  END IF;

  INSERT INTO "model_procurement"."purchase_request" ("requester_id", "amount", "status", "approved_by_id", "approved_by_roles")
  VALUES (v_actor."id", "p_amount", 'DRAFT', NULL, NULL)
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_1e35db0451b1461e941af6283d86dca2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.20.0', 'sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4'), 'actionId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'event:evt_10d694c9a0a274dc79c6168e47d25968', 'RequestOpened', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_1e35db0451b1461e941af6283d86dca2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  UPDATE "model_procurement_internal"."command_receipt"
  SET "status" = 'executed', "response" = v_response, "target_id" = v_result."id",
      "action_audit_id" = v_action_audit_id, "completed_at" = pg_catalog.transaction_timestamp()
  WHERE "id" = v_receipt_id;

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."open_request"(numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."submit_request"("p_request" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_UNSUPPORTED:idempotency:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, pg_catalog.gen_random_uuid()::text);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF NOT (((v_actor."id" = v_request."requester_id")) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_ed2374e822704c51a2925338253d05d2';
  END IF;

  IF NOT (((v_request."status" = 'DRAFT')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_ed2374e822704c51a2925338253d05d2.is_draft';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'SUBMITTED'
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_ed2374e822704c51a2925338253d05d2', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.20.0', 'sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4'), 'actionId', 'action:act_ed2374e822704c51a2925338253d05d2', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_ed2374e822704c51a2925338253d05d2.is_draft', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'event:evt_20d694c9a0a274dc79c6168e47d25968', 'RequestSubmitted', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_ed2374e822704c51a2925338253d05d2', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."submit_request"(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."approve_request"("p_request" uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_identity_issuer text;
  v_identity_subject text;
  v_revision text;
  v_expected_revision text;
  v_idempotency_key text;
  v_correlation_id text;
  v_causation_id text;
  v_request_hash text;
  v_receipt_source_hash text;
  v_receipt_request_hash text;
  v_receipt_status text;
  v_receipt_id bigint;
  v_action_audit_id bigint;
  v_receipt_response jsonb;
  v_response jsonb;
  v_authority_policy_id text;
  v_authority_id text;
  v_result "model_procurement"."purchase_request"%ROWTYPE;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id", identity."identity_issuer", identity."identity_subject"
  INTO v_principal_id, v_identity_issuer, v_identity_subject
  FROM "model_procurement_internal"."resolve_principal"() AS identity;

  v_expected_revision := NULLIF(pg_catalog.current_setting('modellang.expected_revision', true), '');
  v_idempotency_key := NULLIF(pg_catalog.current_setting('modellang.idempotency_key', true), '');
  v_correlation_id := NULLIF(pg_catalog.current_setting('modellang.correlation_id', true), '');
  v_causation_id := NULLIF(pg_catalog.current_setting('modellang.causation_id', true), '');
  PERFORM pg_catalog.set_config('modellang.expected_revision', '', true);
  PERFORM pg_catalog.set_config('modellang.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('modellang.correlation_id', '', true);
  PERFORM pg_catalog.set_config('modellang.causation_id', '', true);

  IF v_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_IDEMPOTENCY_UNSUPPORTED:idempotency:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;
  v_correlation_id := COALESCE(v_correlation_id, pg_catalog.gen_random_uuid()::text);

  IF v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
     OR (v_causation_id IS NOT NULL AND v_causation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:idempotency:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  PERFORM "id" FROM "model_procurement"."user"
  WHERE "id" = ANY (ARRAY[v_principal_id]::uuid[])
  ORDER BY "id" FOR SHARE;

  PERFORM "id" FROM "model_procurement"."purchase_request"
  WHERE "id" = ANY (ARRAY["p_request"]::uuid[])
  ORDER BY "id" FOR UPDATE;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request"
;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END) + (CASE WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END)) = 1))) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ML_AUTHORIZATION:authorize:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  IF v_expected_revision IS NOT NULL AND v_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'ML_STALE:revision:action:act_d39dbb883b5f4019b9027b85add3de47';
  END IF;

  v_authority_policy_id := 'policy:pol_a3a80ffeec774402be92cddaafd0f069';
  v_authority_id := CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 'policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688' WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 'policyBranch:pbr_6b38447b5bf944769d1d737c069c7420' ELSE NULL END;

  IF NOT (((v_request."status" = 'SUBMITTED')) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ML_PRECONDITION:require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted';
  END IF;

  UPDATE "model_procurement"."purchase_request"
  SET "status" = 'APPROVED',
      "approved_by_id" = v_actor."id",
      "approved_by_roles" = v_actor."roles"
  WHERE "id" = v_request."id"
  RETURNING * INTO v_result;

  v_response := jsonb_build_object('id', v_result."id", 'createdAt', v_result."created_at", 'requester', v_result."requester_id", 'amount', jsonb_build_object('currency', 'USD', 'amount', (v_result."amount"::numeric(20, 2))::text), 'status', v_result."status", 'approvedBy', v_result."approved_by_id", 'approvedByRoles', v_result."approved_by_roles");
  INSERT INTO "model_procurement_internal"."action_audit" ("action_id", "database_principal", "principal_id", "target_id", "identity_issuer", "identity_subject", "model_id", "model_version", "source_hash", "authorization_rule_id", "decision_outcome", "policy_id", "authority_id", "decision_evidence", "correlation_id", "causation_id", "command_receipt_id")
  VALUES ('action:act_d39dbb883b5f4019b9027b85add3de47', session_user, v_principal_id, v_result."id", v_identity_issuer, v_identity_subject, 'model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'executed', v_authority_policy_id, v_authority_id, pg_catalog.jsonb_build_object('version', 2, 'outcome', 'executed', 'model', pg_catalog.jsonb_build_object('id', 'model:Procurement', 'version', '0.20.0', 'sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4'), 'actionId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'command', pg_catalog.jsonb_build_object('correlationId', v_correlation_id, 'causationId', v_causation_id, 'receiptId', v_receipt_id), 'authorization', pg_catalog.jsonb_build_object('ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47', 'outcome', 'passed', 'policyId', v_authority_policy_id, 'authorityId', v_authority_id), 'requirements', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('ruleId', 'require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted', 'outcome', 'passed', 'policyIds', pg_catalog.jsonb_build_array()))), v_correlation_id, v_causation_id, v_receipt_id)
  RETURNING "id" INTO v_action_audit_id;

  INSERT INTO "model_procurement_internal"."event_outbox" ("model_id", "model_version", "source_hash", "event_id", "event_name", "payload_entity_id", "action_id", "principal_id", "target_id", "payload", "correlation_id", "causation_id", "action_audit_id", "command_receipt_id", "ordinal")
  VALUES ('model:Procurement', '0.20.0', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'event:evt_30d694c9a0a274dc79c6168e47d25968', 'RequestApproved', 'entity:ent_9bc680209327484c8e98f5f740bcc702', 'action:act_d39dbb883b5f4019b9027b85add3de47', v_principal_id, v_result."id", v_response, v_correlation_id, v_causation_id, v_action_audit_id, v_receipt_id, 0);

  RETURN v_response;
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."approve_request"(uuid) FROM PUBLIC;

RESET ROLE;
-- Generated pure applicability queries. These decisions grant no execution authority.
SET ROLE modellang_owner;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"("p_amount" numeric, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  IF NOT (("p_amount" <> 'NaN'::numeric AND pg_catalog.scale("p_amount") <= 2 AND pg_catalog.abs("p_amount") < 1000000000000000000) IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount';
  END IF;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount', 'value', pg_catalog.to_jsonb(("p_amount")::numeric(20, 2)))))::text);

  IF v_actor_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF NOT ((((('EMPLOYEE' = ANY(v_actor."roles")) OR ('MANAGER' = ANY(v_actor."roles"))) OR ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_1e35db0451b1461e941af6283d86dca2'));
  END IF;

  IF NOT ((("p_amount" > 0)) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_1e35db0451b1461e941af6283d86dca2.positive_amount'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_1e35db0451b1461e941af6283d86dca2', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_1e35db0451b1461e941af6283d86dca2"(numeric, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"("p_request" uuid, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_ed2374e822704c51a2925338253d05d2.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF v_actor_xmin IS NULL OR v_request_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF NOT (((v_actor."id" = v_request."requester_id")) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_ed2374e822704c51a2925338253d05d2'));
  END IF;

  IF NOT (((v_request."status" = 'DRAFT')) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_ed2374e822704c51a2925338253d05d2.is_draft'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_ed2374e822704c51a2925338253d05d2', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_ed2374e822704c51a2925338253d05d2"(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"("p_request" uuid, p_expected_revision text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $modellang$
DECLARE
  v_principal_id uuid;
  v_revision text;
  v_actor "model_procurement"."user"%ROWTYPE;
  v_actor_xmin text;
  v_request "model_procurement"."purchase_request"%ROWTYPE;
  v_request_xmin text;
BEGIN
  SELECT identity."principal_id" INTO v_principal_id
  FROM "model_procurement_internal"."resolve_principal_snapshot"() AS identity;

  SELECT * INTO v_actor
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT row_value.xmin::text INTO v_actor_xmin
  FROM "model_procurement"."user" AS row_value
  WHERE row_value."id" = v_principal_id;

  SELECT * INTO v_request
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  SELECT row_value.xmin::text INTO v_request_xmin
  FROM "model_procurement"."purchase_request" AS row_value
  WHERE row_value."id" = "p_request";

  v_revision := 'rev:1:' || pg_catalog.md5(pg_catalog.jsonb_build_object('sourceHash', 'sha256:007526853c759d424c2cfdaf07a18cffbef523a5b1f501a5fe5fc1fd58462cf4', 'operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'components', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor', 'value', pg_catalog.to_jsonb(v_principal_id), 'rowVersion', pg_catalog.to_jsonb(v_actor_xmin)), pg_catalog.jsonb_build_object('parameterId', 'parameter:action:act_d39dbb883b5f4019b9027b85add3de47.request', 'value', pg_catalog.to_jsonb("p_request"), 'rowVersion', pg_catalog.to_jsonb(v_request_xmin))))::text);

  IF v_actor_xmin IS NULL OR v_request_xmin IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF NOT ((((v_actor."id" <> v_request."requester_id") AND (((CASE WHEN ((((v_request."amount" <= 10000) AND ('MANAGER' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END) + (CASE WHEN ((((v_request."amount" > 10000) AND ('FINANCE' = ANY(v_actor."roles")))) IS TRUE) THEN 1 ELSE 0 END)) = 1))) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'denied', 'applicable', FALSE, 'authority', 'none', 'explanation', pg_catalog.jsonb_build_object('kind', 'authorization', 'ruleId', 'authorize:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF p_expected_revision IS NOT NULL AND p_expected_revision IS DISTINCT FROM v_revision THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'stale', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'revision', 'ruleId', 'revision:action:act_d39dbb883b5f4019b9027b85add3de47'));
  END IF;

  IF NOT (((v_request."status" = 'SUBMITTED')) IS TRUE) THEN
    RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'notApplicable', 'applicable', FALSE, 'authority', 'none', 'revision', v_revision, 'explanation', pg_catalog.jsonb_build_object('kind', 'requirement', 'ruleId', 'require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted'));
  END IF;

  RETURN pg_catalog.jsonb_build_object('operationId', 'action:act_d39dbb883b5f4019b9027b85add3de47', 'status', 'applicable', 'applicable', TRUE, 'authority', 'none', 'revision', v_revision);
END
$modellang$;

REVOKE ALL ON FUNCTION "model_procurement"."decide_act_d39dbb883b5f4019b9027b85add3de47"(uuid, text) FROM PUBLIC;

RESET ROLE;
-- Generated least-privilege application boundary.
REVOKE CREATE ON SCHEMA "model_procurement" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE ALL ON SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT USAGE ON SCHEMA "model_procurement" TO modellang_app;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_gateway;
GRANT USAGE ON SCHEMA "model_procurement_internal" TO modellang_dispatcher;

REVOKE ALL ON TABLE "model_procurement"."user" FROM PUBLIC, modellang_app, modellang_dispatcher;
REVOKE ALL ON TABLE "model_procurement"."purchase_request" FROM PUBLIC, modellang_app, modellang_dispatcher;

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
REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway, modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"(integer, integer) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."ack_event"(uuid, uuid) TO modellang_dispatcher;
GRANT EXECUTE ON FUNCTION "model_procurement_internal"."release_event"(uuid, uuid) TO modellang_dispatcher;

ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE modellang_owner REVOKE ALL ON TABLES FROM PUBLIC;
REVOKE modellang_owner FROM modellang_app;
REVOKE modellang_owner FROM modellang_gateway;
REVOKE modellang_owner, modellang_app, modellang_gateway FROM modellang_dispatcher;
REVOKE modellang_dispatcher FROM modellang_owner, modellang_app, modellang_gateway;
REVOKE modellang_gateway FROM modellang_app;
GRANT modellang_app TO modellang_gateway;
COMMIT;
