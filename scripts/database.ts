import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client, Pool } from "pg";

export const databaseUrl = process.env.MODELLANG_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/modellang";
export const demoPassword = process.env.MODELLANG_DEMO_PASSWORD ?? "modellang-demo-only";

export const demoRoles = [
  "ml_employee_one", "ml_employee_two", "ml_manager", "ml_finance", "ml_unbound",
  "ml_reserver_one", "ml_reserver_two", "ml_gateway", "ml_dispatcher", "ml_consumer", "ml_recovery", "ml_publication_recovery", "ml_failure_observer", "ml_failure_acknowledger",
] as const;

export function loginUrl(role: typeof demoRoles[number]): string {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = demoPassword;
  return url.toString();
}

export async function resetModelSchemas(modelName: "procurement" | "reservations"): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "model_${modelName}_internal" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "model_${modelName}" CASCADE`);
  } finally {
    await client.end();
  }
}

export async function resetGeneratedSchemas(): Promise<void> {
  await resetModelSchemas("procurement");
}

export async function applyGeneratedSql(options: { includeSeed?: boolean; directory?: string } = {}): Promise<void> {
  const directory = resolve(options.directory ?? "generated/procurement/postgres");
  const files = ["001_roles.sql", "002_schema.sql", "003_actions.sql", "003_consumers.sql", "003_queries.sql", "003_decisions.sql", "004_grants.sql"];
  if (options.includeSeed) files.push("005_seed.sql");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

export async function provisionDemoLogins(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const role of demoRoles) {
      await client.query(`DO $provision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE "${role}" LOGIN INHERIT;
  END IF;
END
$provision$;`);
      await client.query(`ALTER ROLE "${role}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${demoPassword.replaceAll("'", "''")}'`);
      await client.query(`REVOKE modellang_gateway FROM "${role}"`);
      await client.query(`REVOKE modellang_dispatcher FROM "${role}"`);
      await client.query(`REVOKE modellang_consumer FROM "${role}"`);
      await client.query(`REVOKE modellang_recovery FROM "${role}"`);
      await client.query(`REVOKE modellang_publication_recovery FROM "${role}"`);
      await client.query(`REVOKE modellang_failure_observer FROM "${role}"`);
      await client.query(`REVOKE modellang_failure_acknowledger FROM "${role}"`);
      if (role === "ml_gateway") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_gateway TO "${role}"`);
      } else if (role === "ml_dispatcher") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_dispatcher TO "${role}"`);
      } else if (role === "ml_consumer") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_consumer TO "${role}"`);
      } else if (role === "ml_recovery") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_recovery TO "${role}"`);
      } else if (role === "ml_publication_recovery") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_publication_recovery TO "${role}"`);
      } else if (role === "ml_failure_observer") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_failure_observer TO "${role}"`);
      } else if (role === "ml_failure_acknowledger") {
        await client.query(`REVOKE modellang_app FROM "${role}"`);
        await client.query(`GRANT modellang_failure_acknowledger TO "${role}"`);
      } else {
        await client.query(`GRANT modellang_app TO "${role}"`);
      }
      await client.query(`REVOKE modellang_owner FROM "${role}"`);
    }
  } finally {
    await client.end();
  }
}

export async function installDemoDatabase(): Promise<void> {
  await resetGeneratedSchemas();
  await applyGeneratedSql();
  await provisionDemoLogins();
  const seed = await readFile(resolve("generated/procurement/postgres/005_seed.sql"), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { await client.query(seed); } finally { await client.end(); }
}

export async function installReservationsDatabase(): Promise<void> {
  await resetModelSchemas("reservations");
  await applyGeneratedSql({ directory: "generated/reservations/postgres" });
  await provisionDemoLogins();
  const seed = await readFile(resolve("generated/reservations/postgres/005_seed.sql"), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try { await client.query(seed); } finally { await client.end(); }
}

export function poolFor(role: typeof demoRoles[number]): Pool {
  return new Pool({ connectionString: loginUrl(role), max: 2 });
}
