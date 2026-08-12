# ModelLang public preview

ModelLang 0.50 is a pre-1.0 public preview of the reference compiler. It is suitable for evaluating the language, deterministic artifacts, PostgreSQL enforcement, generated HTTP/MCP boundaries, and Agent Plugin packaging. It is not a production-support commitment or a claim of complete SML-Agent or SML-Federation conformance.

## Install and inspect a model

Install Node.js 20 or newer and create `app.model`:

```modellang
model ApprovalApp version "0.50.0";

entity User {
  id: UUID @id @generated(uuid);
}

entity Request {
  id: UUID @id @generated(uuid);
  approved: Boolean;
}

entity Approval {
  id: UUID @id @generated(uuid);
  request: Request @unique;
  actor: User;
}

action approve(caller actor: User, request: Request) -> Approval {
  authorize true;
  require pending: request.approved == false;
  update request { approved = true; }
  create Approval { request = request; actor = actor; }
}
```

Install and run the compiler:

```bash
npm install --save-dev @atlanticplatformgroup/modellang@0.50.2
npx modelc check app.model
npx modelc print-ir app.model > model.ir.json
```

Without installing first, `npx @atlanticplatformgroup/modellang@0.50.2 check app.model` resolves the package's CLI temporarily. The installed executable remains available as `modelc`.

## Generate an application boundary

```bash
npx modelc build app.model --out generated/app
```

The output includes canonical IR, contract and assurance manifests, PostgreSQL installation SQL, TypeScript clients and server adapters, OpenAPI, UI metadata, provenance, and the generated MCP server handler. Generated artifacts are replaced atomically and should be regenerated rather than edited.

ModelLang generates a server handler, not deployment infrastructure. The host must provide PostgreSQL connectivity, audience-bound authentication, secrets, extension implementations, delegated-capability storage, monitoring, and a public HTTP endpoint.

The [runnable host/bootstrap guide](./HOST_BOOTSTRAP.md) provides a copyable PostgreSQL installation order, least-privilege gateway provisioning, production-shaped JWT verification, Node HTTP bridging, shared HTTP/MCP subject binding, reconnect-isolation smoke test, and clean shutdown path. It uses only an installed package and generated application; callers never submit ModelLang principal IDs and discovery never grants authority.

## Package a deployed application for agent clients

After the host has a public MCP endpoint:

```bash
npx modelc build app.model \
  --out generated/app \
  --agent-plugin-url https://app.example.com/mcp \
  --agent-plugin-name example.app
```

Install or import `generated/app/agent-plugin/` in an Agent Plugins 1.0.0-compatible client. The package contains public connection metadata and no credentials. Authentication remains client-managed, and every MCP request still passes through the generated application's runtime authorization and policy enforcement.

## Evaluate the reference applications

From a source checkout:

```bash
npm ci
npm run model:check
npm run model:generate
npm run db:up
npm run health
npm run demo
```

The full gate includes a clean-install test of the packed npm artifact plus live PostgreSQL policy, concurrency, evidence, HTTP, MCP, and Agent Plugin boundary coverage.

## Preview compatibility policy

- Canonical IR is exactly IR2; historical IR normalization is not provided.
- Pre-1.0 minor releases may make breaking language or generated-contract changes documented in the changelog and semantic diff.
- Patch releases preserve the current minor's language and generated contract versions except for compatible fixes.
- Only the latest minor receives security fixes during the preview.
- Agent Plugins support is pinned to its external 1.0.0 Working Draft package contract and will not be silently reinterpreted if that standard changes.
