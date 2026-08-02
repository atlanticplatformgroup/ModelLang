import type { ModelIR } from "../ir.js";
import { quoteIdent } from "../naming.js";

function qname(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

export function generateUpgradeBaselineCheck(ir: ModelIR): string {
  const internal = ir.model.naming.internalSchema;
  const modelId = ir.model.id.replaceAll("'", "''");
  const version = ir.model.version.replaceAll("'", "''");
  const sourceHash = ir.model.sourceHash.replaceAll("'", "''");
  return `DO $modellang_upgrade$
DECLARE
  v_model_id text;
  v_version text;
  v_source_hash text;
BEGIN
  SELECT ${quoteIdent("model_id")}, ${quoteIdent("version")}, ${quoteIdent("source_hash")}
  INTO v_model_id, v_version, v_source_hash
  FROM ${qname(internal, "schema_migrations")}
  ORDER BY ${quoteIdent("id")} DESC LIMIT 1;
  IF NOT FOUND
     OR v_model_id IS DISTINCT FROM '${modelId}'
     OR v_version IS DISTINCT FROM '${version}'
     OR v_source_hash IS DISTINCT FROM '${sourceHash}' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_MIGRATION_BASELINE:${sourceHash}';
  END IF;
END
$modellang_upgrade$;`;
}

export function generateRuntimeProfileGuard(ir: ModelIR, targetProfile: number): string {
  const runtimeProfile = qname(ir.model.naming.internalSchema, "runtime_profile");
  return `CREATE TABLE IF NOT EXISTS ${runtimeProfile} (
  ${quoteIdent("singleton")} boolean PRIMARY KEY DEFAULT TRUE,
  ${quoteIdent("profile_version")} integer NOT NULL,
  CONSTRAINT ${quoteIdent("ck_runtime_profile_singleton")} CHECK (${quoteIdent("singleton")}),
  CONSTRAINT ${quoteIdent("ck_runtime_profile_version")} CHECK (${quoteIdent("profile_version")} >= 0)
);
LOCK TABLE ${runtimeProfile} IN EXCLUSIVE MODE;
DO $modellang_runtime_profile$
DECLARE
  v_profile_version integer;
BEGIN
  SELECT ${quoteIdent("profile_version")} INTO v_profile_version
  FROM ${runtimeProfile} WHERE ${quoteIdent("singleton")} FOR UPDATE;
  IF FOUND AND v_profile_version > ${targetProfile} THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ML_RUNTIME_PROFILE_DOWNGRADE:${targetProfile}:' || v_profile_version;
  END IF;
END
$modellang_runtime_profile$;`;
}

export function generateRuntimeProfileAdvance(ir: ModelIR, targetProfile: number): string {
  const runtimeProfile = qname(ir.model.naming.internalSchema, "runtime_profile");
  return `INSERT INTO ${runtimeProfile} (${quoteIdent("singleton")}, ${quoteIdent("profile_version")})
VALUES (TRUE, ${targetProfile})
ON CONFLICT (${quoteIdent("singleton")}) DO UPDATE
SET ${quoteIdent("profile_version")} = GREATEST(${runtimeProfile}.${quoteIdent("profile_version")}, EXCLUDED.${quoteIdent("profile_version")});`;
}
