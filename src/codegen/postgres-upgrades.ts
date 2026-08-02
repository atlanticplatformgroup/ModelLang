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
