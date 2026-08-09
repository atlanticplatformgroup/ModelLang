# ModelLang quickstart reference

Use this reference when installing ModelLang or creating a first model. Prefer the repository's current README and version-matched specification if they differ from this summary.

## Requirements

- Node.js 20 or newer
- The `modellang` development dependency
- The package's `modelc` executable

## Minimal workflow

```bash
npm install --save-dev modellang
npx --no-install modelc check app.model
npx --no-install modelc build app.model --out generated/app
```

For the ModelLang source checkout itself:

```bash
npm ci
npm run build
node dist/src/cli.js check app.model
node dist/src/cli.js build app.model --out generated/app
```

## Small valid model

```modellang
model ApprovalApp version "0.50.0";

entity User {
  id: UUID @id @generated(uuid);
  canApprove: Boolean;
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
  authorize actor.canApprove;
  require pending: request.approved == false;
  update request { approved = true; }
  create Approval { request = request; actor = actor; }
}
```

This action authorizes the caller, checks the request state, updates the request, and creates the approval in one generated database transaction.

## Generated boundary

A normal build produces a directory containing canonical IR and generated PostgreSQL, TypeScript, OpenAPI, MCP/agent, enforcement, and provenance artifacts. Exact filenames may evolve during the public preview; inspect the actual output instead of assuming every file exists.

Generated files are replaceable compiler output. Edit the `.model` source and rebuild.

## Trust boundary

ModelLang generates enforcement and interfaces, not a hosted application. The host still provides PostgreSQL connectivity and installation, audience-bound credential verification, secret management, extension implementations, monitoring, and an HTTP/MCP endpoint. Caller identity must be bound by the host and database session, not accepted as an ordinary action argument.
