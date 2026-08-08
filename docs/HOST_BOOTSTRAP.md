# Host and bootstrap a generated application

This guide starts where `modelc build` finishes. It shows the smallest practical PostgreSQL, authenticated HTTP, and authenticated MCP host for a generated application. The host owns identity verification and infrastructure; generated ModelLang code owns operation validation and runtime policy enforcement.

The examples use a model named `Workshop`, generated into `generated/workshop`. Replace `Workshop`, `model_workshop`, and the seed columns with names from your model. Nothing imports from a ModelLang source checkout.

## 1. Install and generate

```bash
mkdir workshop-host && cd workshop-host
npm init -y
npm install --save-dev modellang@0.50.0 tsx typescript @types/node @types/pg
npm install pg jose @modelcontextprotocol/client
npx modelc check app.model
npx modelc build app.model --out generated/workshop \
  --agent-plugin-url https://workshop.example.test/mcp \
  --agent-plugin-name example.workshop
```

Generated TypeScript is application code, so configure Node ESM (`"type": "module"` in `package.json`). Regenerate the directory rather than editing it.

## 2. Apply PostgreSQL in order

Use PostgreSQL 16 and an administrative connection that can create roles, schemas, tables, functions, and extensions. Apply every generated file in this order:

```bash
export WORKSHOP_ADMIN_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/workshop'

for file in \
  001_roles.sql \
  002_schema.sql \
  003_actions.sql \
  003_consumers.sql \
  003_decisions.sql \
  003_queries.sql \
  004_grants.sql \
  005_seed.sql
do
  psql "$WORKSHOP_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f "generated/workshop/postgres/$file"
done
```

`ON_ERROR_STOP=1` is important: unexpected SQL errors must stop bootstrap. The generated role-membership cleanup avoids known harmless missing-membership warnings but does not globally suppress PostgreSQL warnings or errors.

## 3. Provision principals and a gateway login

Generated actions never accept a caller or principal ID as an ordinary input. A trusted administrative path provisions model principals and binds verified external identity to them.

Adapt this bootstrap to your principal entity and issuer. Run it through the administrative connection, never the application connection:

```sql
SET ROLE modellang_owner;

INSERT INTO model_workshop."user" (id, name, roles) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Member One', ARRAY['MEMBER']),
  ('10000000-0000-4000-8000-000000000002', 'Staff One', ARRAY['STAFF']);

INSERT INTO model_workshop_internal.gateway_principal_binding
  (issuer, subject, principal_id)
VALUES
  ('https://identity.example.test/', 'member-one', '10000000-0000-4000-8000-000000000001'),
  ('https://identity.example.test/', 'staff-one', '10000000-0000-4000-8000-000000000002');

RESET ROLE;

CREATE ROLE workshop_gateway LOGIN PASSWORD 'replace-through-secret-management'
  NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
GRANT modellang_gateway TO workshop_gateway;
```

Store the gateway password in deployment secret management. The gateway login can execute generated boundaries through `modellang_gateway`; it cannot directly read or mutate model tables or principal bindings.

## 4. Verify bearer credentials in the host

The generated adapter deliberately does not choose a JWT library or identity provider. The host must cryptographically verify at least signature, issuer, audience, subject, and expiry. It should also enforce deployment-specific algorithms, clock tolerance, required claims, revocation/session policy, and key rotation.

```ts
// src/identity.ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://identity.example.test/";
const audience = "https://workshop.example.test/";
const keys = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  expiresAt: number;
  token: string;
}

export async function verifyAccessToken(token: string): Promise<VerifiedIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["iss", "sub", "aud", "exp"],
    });
    if (!payload.iss || !payload.sub || !payload.exp) return null;
    return { issuer: payload.iss, subject: payload.sub, expiresAt: payload.exp, token };
  } catch {
    return null;
  }
}
```

For a local demonstration, a host may replace this function with a fixed token-to-subject map. Label that code as demonstration-only. A string comparison is not production authentication.

## 5. Construct one executor per verified request

The generated gateway binds issuer and subject transaction-locally before every operation. It never accepts a ModelLang principal ID:

```ts
// src/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Pool } from "pg";
import { createWorkshopGatewayExecutor } from "../generated/workshop/typescript/gateway.js";
import { createWorkshopHttpHandler } from "../generated/workshop/typescript/http-server.js";
import { createWorkshopMcpHandler } from "../generated/workshop/typescript/mcp-server.js";
import { verifyAccessToken } from "./identity.js";

const port = Number(process.env.PORT ?? 4310);
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "https://workshop.example.test";
const databaseUrl = process.env.WORKSHOP_DATABASE_URL;
if (!databaseUrl) throw new Error("WORKSHOP_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

async function authenticate(token: string) {
  const identity = await verifyAccessToken(token);
  if (!identity) return null;
  return {
    identity,
    executor: createWorkshopGatewayExecutor(pool, {
      issuer: identity.issuer,
      subject: identity.subject,
    }),
  };
}

const httpHandler = createWorkshopHttpHandler(async (token) => {
  const authenticated = await authenticate(token);
  return authenticated?.executor ?? null;
});

const mcpHandler = createWorkshopMcpHandler(async (token) => {
  const authenticated = await authenticate(token);
  if (!authenticated) return null;
  return {
    authInfo: {
      token,
      clientId: `workshop:${authenticated.identity.subject}`,
      scopes: ["workshop"],
      expiresAt: authenticated.identity.expiresAt,
      resource: new URL(`${publicOrigin}/mcp`),
    },
    executor: authenticated.executor,
  };
}, {
  resourceServerUrl: `${publicOrigin}/mcp`,
  discoveryCacheTtlMs: 0,
});

async function toFetchRequest(request: IncomingMessage): Promise<Request> {
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : Readable.toWeb(request) as ReadableStream;
  return new Request(`${publicOrigin}${request.url}`, {
    method: request.method,
    headers: request.headers as HeadersInit,
    body,
    duplex: body ? "half" : undefined,
  } as RequestInit);
}

async function send(source: Response, target: ServerResponse): Promise<void> {
  target.writeHead(source.status, Object.fromEntries(source.headers.entries()));
  target.end(Buffer.from(await source.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    const fetchRequest = await toFetchRequest(request);
    const result = new URL(fetchRequest.url).pathname === "/mcp"
      ? await mcpHandler.fetch(fetchRequest)
      : await httpHandler(fetchRequest);
    await send(result, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    await send(new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }), response);
  }
});

server.listen(port, "127.0.0.1");

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown().then(() => process.exit(0), (error) => {
    console.error(error);
    process.exit(1);
  }));
}
```

HTTP and MCP call the same verifier and construct the same issuer/subject-bound executor. The generated MCP handler is stateless: every request authenticates independently. Do not put an executor, identity, or authority into a connection-global variable.

Discovery metadata, `tools/list`, applicability decisions, resource envelopes, and Agent Plugin files grant no authority. Execution reloads current state and enforces policy again.

## 6. Exercise allowed and denied behavior

Find stable routes in `generated/workshop/openapi.json` or use the generated browser client. For raw HTTP, call the same operation with member and staff tokens and confirm one succeeds and one returns the generated authorization error:

```bash
curl -i -X POST 'https://workshop.example.test/operations/actions/<stable-action-id>' \
  -H 'Authorization: Bearer <staff-token>' \
  -H 'Content-Type: application/json' \
  --data '{"asset":"<uuid>"}'

curl -i -X POST 'https://workshop.example.test/operations/actions/<stable-action-id>' \
  -H 'Authorization: Bearer <member-token>' \
  -H 'Content-Type: application/json' \
  --data '{"asset":"<uuid>"}'
```

Use an MCP client with a fresh transport for each subject:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function connect(token: string) {
  const client = new Client({ name: "workshop-smoke", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(
    new URL("https://workshop.example.test/mcp"),
    { authProvider: { token: async () => token } },
  ));
  return client;
}

const staff = await connect(process.env.STAFF_TOKEN!);
await staff.callTool({ name: "<stable-action-id>", arguments: { asset: "<uuid>" } });
await staff.close();

const member = await connect(process.env.MEMBER_TOKEN!);
const denied = await member.callTool({ name: "<stable-action-id>", arguments: { asset: "<uuid>" } });
if (!denied.isError) throw new Error("member unexpectedly retained staff authority");
await member.close();
```

Also test an allowed and denied query/resource call. Successful current-state MCP resources must retain their generated envelope and zero-age freshness metadata; transport responses remain `Cache-Control: no-store`.

## 7. Production responsibilities

This bootstrap is intentionally small. A production host additionally owns TLS termination, trusted proxy rules, CORS/CSRF policy, database credential rotation, connection limits, token revocation, delegated-capability storage if enabled, monitoring, rate limiting, shutdown deadlines, migrations, backups, and incident response. None of those responsibilities should weaken generated runtime authorization or expose elevated PostgreSQL credentials to callers.
