import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { generateAll } from "../src/build.js";
import { createHash } from "node:crypto";

async function procurement() {
  const source = await readFile("examples/procurement.model", "utf8");
  return compileText(source, "examples/procurement.model");
}

async function reservations() {
  const source = await readFile("examples/reservations.model", "utf8");
  return compileText(source, "examples/reservations.model");
}

describe("backends", () => {
  it("generates deterministic output from IR only", async () => {
    const ir = await procurement();
    expect(generateAll(ir)).toEqual(generateAll(ir));
  });

  it("matches every committed golden artifact byte-for-byte", async () => {
    const output = generateAll(await procurement());
    for (const [path, expected] of Object.entries(output)) {
      expect(await readFile(`generated/procurement/${path}`, "utf8"), path).toBe(expected);
    }
    const reservationOutput = generateAll(await reservations());
    for (const [path, expected] of Object.entries(reservationOutput)) {
      expect(await readFile(`generated/reservations/${path}`, "utf8"), `reservations/${path}`).toBe(expected);
    }
  });

  it("derives a transport-neutral operation manifest and stable HTTP boundary from canonical IR", async () => {
    const output = generateAll(await procurement());
    const manifest = JSON.parse(output["operations.json"]!) as {
      manifestVersion: number;
      authentication: { source: string; requestSupplied: boolean };
      entities: { name: string; idFieldId: string }[];
      operations: { id: string; kind: string; name: string; input: { name: string }[]; caller: { requestSupplied: boolean }; reliability?: { idempotency: string } }[];
      workflows: { id: string; transitions: { id: string; actionId: string; target: object }[] }[];
    };
    const schema = JSON.parse(await readFile("schemas/operation-manifest.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.manifestVersion).toBe(4);
    expect(manifest.authentication).toEqual(expect.objectContaining({
      source: "authenticatedContext",
      requestSupplied: false,
    }));
    expect(manifest.entities.find((entity) => entity.name === "PurchaseRequest")?.idFieldId)
      .toBe("field:fld_af918d24406040619a77b244a81ca5d3");
    expect(manifest.operations).toHaveLength(4);
    for (const operation of manifest.operations) {
      expect(operation.caller.requestSupplied).toBe(false);
      expect(operation.input.map((parameter) => parameter.name)).not.toContain("actor");
    }
    expect(manifest.operations.find((operation) => operation.name === "openRequest")?.reliability)
      .toMatchObject({ idempotency: "required" });
    expect(manifest.operations.find((operation) => operation.name === "submitRequest")?.reliability)
      .toMatchObject({ idempotency: "unsupported" });
    expect(manifest.workflows).toEqual([expect.objectContaining({
      id: "workflow:wfl_96a1115ba9bf42f2a206374822eeaa87",
      transitions: [
        expect.objectContaining({
          id: "transition:trn_7787ccd311944f109b69e35967bcbe2c",
          actionId: "action:act_ed2374e822704c51a2925338253d05d2",
          target: {
            source: "operationInput",
            parameterId: "parameter:action:act_ed2374e822704c51a2925338253d05d2.request",
            name: "request",
          },
        }),
        expect.objectContaining({ id: "transition:trn_efd18c8576154ba8b138c97b551afae3" }),
      ],
    })]);
    const reservationManifest = JSON.parse(generateAll(await reservations())["operations.json"]!) as { workflows: object[] };
    expect(validate(reservationManifest), JSON.stringify(validate.errors)).toBe(true);
    expect(reservationManifest.workflows).toEqual([]);

    const openapi = JSON.parse(output["openapi.json"]!) as {
      openapi: string;
      paths: Record<string, { post: { summary: string; parameters: { $ref: string }[]; requestBody: { content: { "application/json": { schema: { additionalProperties: boolean; properties: Record<string, unknown> } } } } } }>;
      components: { parameters: Record<string, { name: string; required: boolean }> };
    };
    expect(openapi.openapi).toBe("3.1.1");
    const openRoute = "/operations/actions/act_1e35db0451b1461e941af6283d86dca2";
    expect(openapi.paths[openRoute]?.post.summary).toBe("openRequest");
    const requestSchema = openapi.paths[openRoute]!.post.requestBody.content["application/json"].schema;
    expect(requestSchema.additionalProperties).toBe(false);
    expect(requestSchema.properties).not.toHaveProperty("actor");
    expect(openapi.paths[openRoute]!.post.parameters).toEqual(expect.arrayContaining([
      { $ref: "#/components/parameters/IdempotencyKey" },
      { $ref: "#/components/parameters/CorrelationId" },
      { $ref: "#/components/parameters/CausationId" },
    ]));
    expect(openapi.components.parameters.IdempotencyKey).toMatchObject({ name: "Idempotency-Key", required: true });
    expect(openapi.components.parameters.CorrelationId).toMatchObject({ name: "X-Correlation-ID", required: false });
    expect(openapi.components.parameters.CausationId).toMatchObject({ name: "X-Causation-ID", required: false });

    const browser = `${output["typescript/browser.ts"]}\n${output["typescript/http-client.ts"]}`;
    expect(browser).not.toMatch(/QueryAdapter|SELECT |session_user|PostgreSQL|node:/);
    expect(output["typescript/http-client.ts"]).toContain(`authorization: \`Bearer \${token}\``);
    expect(output["typescript/http-server.ts"]).toContain("createProcurementDatabaseExecutor");
    expect(output["typescript/gateway.ts"]).toContain("createProcurementGatewayExecutor");
    expect(output["typescript/gateway.ts"]).toContain('bind_gateway_identity"($1, $2)');
  });

  it("separates the enforcement decision plan from the filtered public capability contract", async () => {
    const output = generateAll(await procurement());
    const decisions = JSON.parse(output["decisions.json"]!) as {
      planVersion: number;
      policies: { id: string; evaluation: string; ambiguousBehavior: string; branches: { id: string }[] }[];
      public: boolean;
      audience: string;
      actions: { operationId: string; authorityPolicyId?: string; authorization: { id: string; expression: object }; preconditions: { id: string; expression: object }[] }[];
    };
    const capabilities = JSON.parse(output["capabilities.json"]!) as {
      view: { safeProjection: boolean; containsExpressions: boolean; containsCurrentState: boolean; grantsAuthority: boolean };
      authentication: { callerInput: boolean };
      actions: { operationId: string; reliability: { idempotency: string }; outcomes: string[]; explanation: { authorizationRuleId: string; preconditionRuleIds: string[] }; revision: { staleRequiresExpectedRevision: boolean; grantsAuthority: boolean } }[];
    };
    const decisionSchema = JSON.parse(await readFile("schemas/decision-plan.schema.json", "utf8")) as object;
    const capabilitySchema = JSON.parse(await readFile("schemas/capability-manifest.schema.json", "utf8")) as object;
    expect(new Ajv2020({ allErrors: true, strict: true }).compile(decisionSchema)(decisions)).toBe(true);
    expect(new Ajv2020({ allErrors: true, strict: true }).compile(capabilitySchema)(capabilities)).toBe(true);
    expect(decisions).toMatchObject({ planVersion: 2, public: false, audience: "enforcement" });
    expect(decisions.policies).toEqual([expect.objectContaining({
      id: "policy:pol_a3a80ffeec774402be92cddaafd0f069",
      evaluation: "exactlyOneBranch",
      ambiguousBehavior: "deny",
      branches: [
        { id: "policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688", expression: expect.any(Object) },
        { id: "policyBranch:pbr_6b38447b5bf944769d1d737c069c7420", expression: expect.any(Object) },
      ],
    })]);
    expect(decisions.actions.find((action) => action.operationId.endsWith("d39dbb883b5f4019b9027b85add3de47")))
      .toMatchObject({ authorityPolicyId: "policy:pol_a3a80ffeec774402be92cddaafd0f069" });
    expect(decisions.actions[0]!.authorization.expression).toBeDefined();
    expect(capabilities).toMatchObject({
      view: { safeProjection: true, containsExpressions: false, containsCurrentState: false, grantsAuthority: false },
      authentication: { callerInput: false },
    });
    expect(JSON.stringify(capabilities)).not.toMatch(/expression|currentValue|sqlFunction|lockPlan|policyId|authorityId|decisionEvidence|idempotencyKey|requestHash|commandReceipt/);
    for (const capability of capabilities.actions) {
      expect(capability.outcomes).toEqual(["applicable", "denied", "notApplicable", "stale"]);
      expect(capability.revision).toEqual(expect.objectContaining({ staleRequiresExpectedRevision: true, grantsAuthority: false }));
    }
    expect(capabilities.actions[0]!.reliability).toMatchObject({ idempotency: "required" });
    expect(output["typescript/capabilities.ts"]).toContain("Safe public capability contract");
    expect(output["typescript/http-server.ts"]).toContain("validateDecision");
    expect(output["postgres/003_actions.sql"]).toContain('"decision_evidence"');
    expect(output["postgres/003_actions.sql"]).toContain("policyBranch:pbr_0d694c9a0a274dc79c6168e47d259688");
    expect(output["postgres/008_upgrade_0_18.sql"]).toContain("durable decision-evidence upgrade");
    expect(output["postgres/009_upgrade_0_19.sql"]).toContain("reliable-command upgrade");
    expect(output["postgres/003_actions.sql"]).toContain('"command_receipt"');
    expect(output["postgres/003_actions.sql"]).toContain("pg_catalog.sha256");
  });

  it("emits engineering-only semantic closure and deterministic artifact provenance", async () => {
    const output = generateAll(await procurement());
    const packageInfo = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const semantic = JSON.parse(output["semantic.json"]!) as {
      manifestVersion: number;
      audience: string;
      view: { authorizationFiltered: boolean; currentState: boolean; executable: boolean };
      provenance: { compilerVersion: string; irVersion: number };
      policies: { id: string; usedBy: { operationId: string; usage: string }[]; coverage: { applicability: boolean; execution: boolean; durableEvidence: boolean } }[];
      actions: {
        name: string;
        reliability: { idempotency: string; durableReceipt: boolean };
        authorization: { id: string; dependencies: { kind: string; id: string }[] };
        readSet: { entityIds: string[]; fieldIds: string[] };
        effect: { kind: string; assignments: { fieldId: string }[] };
        postconditions: { invariantIds: string[] };
        workflowTransitionIds: string[];
      }[];
    };
    const semanticSchema = JSON.parse(await readFile("schemas/semantic-manifest.schema.json", "utf8")) as object;
    const validateSemantic = new Ajv2020({ allErrors: true, strict: true }).compile(semanticSchema);
    expect(validateSemantic(semantic), JSON.stringify(validateSemantic.errors)).toBe(true);
    expect(semantic).toMatchObject({
      manifestVersion: 7,
      audience: "engineering",
      view: { authorizationFiltered: false, currentState: false, executable: false },
      provenance: { compilerVersion: packageInfo.version, irVersion: 15 },
    });
    expect(semantic.policies).toEqual([expect.objectContaining({
      id: "policy:pol_a3a80ffeec774402be92cddaafd0f069",
      usedBy: [expect.objectContaining({
        operationId: "action:act_d39dbb883b5f4019b9027b85add3de47",
        usage: "authorization",
      })],
      coverage: { applicability: true, execution: true, durableEvidence: true },
    })]);
    const approve = semantic.actions.find((action) => action.name === "approveRequest")!;
    expect(approve.authorization.id).toBe("authorize:action:act_d39dbb883b5f4019b9027b85add3de47");
    expect(approve.authorization.dependencies).toContainEqual({
      kind: "parameter",
      id: "parameter:action:act_d39dbb883b5f4019b9027b85add3de47.actor",
    });
    expect(approve.readSet.fieldIds).toEqual(expect.arrayContaining([
      "field:fld_04d9bc06877d4ec38a98196239c949b5",
      "field:fld_9810e7598584487ea4a883e3c1c3f8d1",
      "field:fld_b4b29a4d0d914ec0913e578da89e5dcb",
    ]));
    expect(approve.effect).toMatchObject({ kind: "update" });
    expect(approve.effect.assignments.map((assignment) => assignment.fieldId)).toEqual([
      "field:fld_afb1dee14dfa48c98961fdb40e2b0be2",
      "field:fld_5da56f04460f4deba9ccda4f552c2b97",
      "field:fld_577b4c94c9cd4b469aded37614712fba",
    ]);
    expect(approve.postconditions.invariantIds).toHaveLength(3);
    expect(approve.workflowTransitionIds).toEqual(["transition:trn_efd18c8576154ba8b138c97b551afae3"]);
    expect(semantic.actions.find((action) => action.name === "openRequest")?.reliability)
      .toMatchObject({ idempotency: "required", durableReceipt: true });

    const provenance = JSON.parse(output["provenance.json"]!) as {
      compilerVersion: string;
      irVersion: number;
      artifacts: { path: string; role: string; sha256: string }[];
    };
    const provenanceSchema = JSON.parse(await readFile("schemas/artifact-provenance.schema.json", "utf8")) as object;
    const validateProvenance = new Ajv2020({ allErrors: true, strict: true }).compile(provenanceSchema);
    expect(validateProvenance(provenance), JSON.stringify(validateProvenance.errors)).toBe(true);
    expect(provenance).toMatchObject({ compilerVersion: packageInfo.version, irVersion: 15 });
    expect(provenance.artifacts.some((artifact) => artifact.path === "provenance.json")).toBe(false);
    const operation = provenance.artifacts.find((artifact) => artifact.path === "operations.json")!;
    expect(operation.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "decisions.json")?.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "capabilities.json")?.role).toBe("contract");
    expect(operation.sha256).toBe(`sha256:${createHash("sha256").update(output["operations.json"]!, "utf8").digest("hex")}`);
  });

  it("derives a schema-valid framework-neutral UI manifest from the operation boundary", async () => {
    const output = generateAll(await procurement());
    const manifest = JSON.parse(output["ui.json"]!) as {
      uiManifestVersion: number;
      operationManifestVersion: number;
      authentication: { required: boolean; callerInput: boolean };
      enums: { name: string; label: string; options: { value: string; label: string }[] }[];
      entities: { name: string; idFieldId: string; fields: { name: string; generated?: string; snapshot: boolean; presentation: object }[] }[];
      actions: { operationId: string; name: string; label: string; reliability: { idempotency: string }; fields: { name: string; presentation: object }[] }[];
      queries: { operationId: string; name: string; label: string; filters: object[]; maxItems: number }[];
      workflows: {
        workflowId: string;
        label: string;
        states: { value: string; initial: boolean; terminal: boolean }[];
        transitions: { transitionId: string; label: string; fromValue: string; toValue: string; actionOperationId: string; target: object; fields: object[] }[];
      }[];
    };
    const schema = JSON.parse(await readFile("schemas/ui-manifest.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      uiManifestVersion: 4,
      operationManifestVersion: 4,
      authentication: { required: true, callerInput: false },
    });

    const open = manifest.actions.find((action) => action.name === "openRequest")!;
    expect(open).toMatchObject({
      operationId: "action:act_1e35db0451b1461e941af6283d86dca2",
      label: "Open request",
      reliability: { idempotency: "required", scope: "authenticatedPrincipal" },
    });
    expect(open.fields).toEqual([expect.objectContaining({
      name: "amount",
      presentation: { kind: "money", currency: "USD", precision: 20, scale: 2 },
    })]);
    expect(open.fields.map((field) => field.name)).not.toContain("actor");

    expect(manifest.queries.find((query) => query.name === "myRequests")).toMatchObject({
      operationId: "query:qry_4406b045404a48449282db804f6167a8",
      label: "My requests",
      filters: [],
      maxItems: 100,
    });
    expect(manifest.enums.find((enumeration) => enumeration.name === "RequestStatus")).toMatchObject({
      label: "Request status",
      options: [
        { value: "DRAFT", label: "Draft" },
        { value: "SUBMITTED", label: "Submitted" },
        { value: "APPROVED", label: "Approved" },
      ],
    });
    const request = manifest.entities.find((entity) => entity.name === "PurchaseRequest")!;
    expect(request.idFieldId).toBe("field:fld_af918d24406040619a77b244a81ca5d3");
    expect(request.fields.find((field) => field.name === "createdAt")).toMatchObject({
      generated: "now",
      presentation: { kind: "dateTime" },
    });
    expect(request.fields.find((field) => field.name === "approvedByRoles")).toMatchObject({
      snapshot: true,
      presentation: { kind: "enumSet" },
    });
    expect(manifest.workflows).toEqual([expect.objectContaining({
      workflowId: "workflow:wfl_96a1115ba9bf42f2a206374822eeaa87",
      label: "Purchase request lifecycle",
      states: [
        expect.objectContaining({ value: "DRAFT", initial: true, terminal: false }),
        expect.objectContaining({ value: "SUBMITTED", initial: false, terminal: false }),
        expect.objectContaining({ value: "APPROVED", initial: false, terminal: true }),
      ],
      transitions: [
        expect.objectContaining({
          transitionId: "transition:trn_7787ccd311944f109b69e35967bcbe2c",
          label: "Submit",
          fromValue: "DRAFT",
          toValue: "SUBMITTED",
          actionOperationId: "action:act_ed2374e822704c51a2925338253d05d2",
          target: expect.objectContaining({ source: "operationInput", name: "request" }),
          fields: [],
        }),
        expect.objectContaining({ label: "Approve", fromValue: "SUBMITTED", toValue: "APPROVED" }),
      ],
    })]);

    expect(output["typescript/ui.ts"]).toContain("createProcurementUiExecutor");
    expect(output["typescript/ui.ts"]).toContain("createProcurementUiWorkflowExecutor");
    expect(output["typescript/ui.ts"]).toContain('case "action:act_1e35db0451b1461e941af6283d86dca2"');
    expect(output["typescript/browser.ts"]).toContain('export * from "./ui.js"');
    expect(`${output["ui.json"]}\n${output["typescript/ui.ts"]}`).not.toMatch(/SELECT |session_user|PostgreSQL|node:/);

    const reservationManifest = JSON.parse(generateAll(await reservations())["ui.json"]!) as { workflows: object[] };
    expect(validate(reservationManifest), JSON.stringify(validate.errors)).toBe(true);
    expect(reservationManifest.workflows).toEqual([]);
  });

  it("removes only the bound workflow target from transition fields", () => {
    const output = generateAll(compileText(`model TransitionFields version "1";
      enum State { NEW, DONE }
      entity User { id: UUID @id; }
      entity Task {
        id: UUID @id;
        state: State = State.NEW;
        note: String;
      }
      action finish(caller actor: User, task: Task, note: String) -> Task {
        authorize true;
        require is_new: task.state == State.NEW;
        update task { state = State.DONE; note = note; }
      }
      workflow TaskLifecycle for Task.state {
        initial State.NEW;
        transition finish: State.NEW -> State.DONE by finish;
      }`, "transition-fields.model"));
    const ui = JSON.parse(output["ui.json"]!) as {
      workflows: { transitions: { target: { name: string }; fields: { name: string; presentation: object }[] }[] }[];
    };
    expect(ui.workflows[0]!.transitions[0]).toMatchObject({
      target: { source: "operationInput", name: "task" },
      fields: [{ name: "note", presentation: { kind: "text" } }],
    });
    expect(output["typescript/ui.ts"]).toContain('Omit<FinishInput, "task">');
  });

  it("keeps stable-ID HTTP routes unchanged across operation renames", () => {
    const source = (name: string) => `model RouteProof version "1";
      entity User @stableId("ent_11111111111111111111111111111111") {
        id: UUID @id @stableId("fld_11111111111111111111111111111111");
      }
      entity Item @stableId("ent_22222222222222222222222222222222") {
        id: UUID @id @stableId("fld_22222222222222222222222222222222");
      }
      action ${name} @stableId("act_11111111111111111111111111111111")(caller actor: User, id: UUID) -> Item {
        authorize true;
        create Item { id = id; }
      }`;
    const beforeOutput = generateAll(compileText(source("firstName")));
    const afterOutput = generateAll(compileText(source("secondName")));
    const before = JSON.parse(beforeOutput["openapi.json"]!) as { paths: object };
    const after = JSON.parse(afterOutput["openapi.json"]!) as { paths: object };
    expect(Object.keys(before.paths)).toEqual(Object.keys(after.paths));
    expect(Object.keys(after.paths)).toEqual([
      "/operations/actions/act_11111111111111111111111111111111",
      "/operations/actions/act_11111111111111111111111111111111/applicability",
    ]);
    const beforeUi = JSON.parse(beforeOutput["ui.json"]!) as { actions: { operationId: string; label: string }[] };
    const afterUi = JSON.parse(afterOutput["ui.json"]!) as { actions: { operationId: string; label: string }[] };
    expect(beforeUi.actions[0]!.operationId).toBe(afterUi.actions[0]!.operationId);
    expect(beforeUi.actions[0]!.label).toBe("First name");
    expect(afterUi.actions[0]!.label).toBe("Second name");
  });

  it("emits atomic half-open temporal exclusion enforcement", async () => {
    const output = generateAll(await reservations());
    const schema = output["postgres/002_schema.sql"];
    expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(schema).toContain('CHECK (("starts_at" < "ends_at") IS TRUE)');
    expect(schema).toContain("EXCLUDE USING gist");
    expect(schema).toContain("tstzrange(\"starts_at\", \"ends_at\", '[)')");
    expect(output["typescript/errors.ts"]).toContain('value?.code === "23P01"');
    expect(output["typescript/errors.ts"]).toContain("class ConflictError");
    expect(output["enforcement.md"]).toContain("exclusion:exc_d55bab6e14884cd5a7d2bacfc30458ba");
    expect(output["model.mmd"]).toContain("Temporal exclusion: no_overlapping_reservations");
  });

  it("uses database-owned defaults for generated values and returns them to typed clients", async () => {
    const output = generateAll(await procurement());
    const schema = output["postgres/002_schema.sql"];
    const actions = output["postgres/003_actions.sql"];
    const types = output["typescript/types.ts"];
    expect(schema).toContain('"id" uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY');
    expect(schema).toContain('"created_at" timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp()');
    expect(actions).toContain('CREATE OR REPLACE FUNCTION "model_procurement"."open_request"("p_amount" numeric)');
    expect(actions).not.toContain('"p_id"');
    expect(actions).toContain("RETURNING * INTO v_result");
    expect(types).toContain('export interface OpenRequestInput {\n  amount: Money<"USD">;\n}');
    expect(types).toContain("Generated by the database using uuid; immutable after creation.");
    expect(types).toContain("Generated by the database using now; immutable after creation.");
    expect(output["enforcement.md"]).toContain("generated:field:fld_af918d24406040619a77b244a81ca5d3");
  });

  it("enforces exact currency-typed money across PostgreSQL and TypeScript", async () => {
    const output = generateAll(await procurement());
    const schema = output["postgres/002_schema.sql"];
    const actions = output["postgres/003_actions.sql"];
    const types = output["typescript/types.ts"];
    const client = output["typescript/client.ts"];
    expect(schema).toContain('"amount" numeric NOT NULL');
    expect(schema).toContain('CONSTRAINT "ck_purchase_request_amount_money"');
    expect(schema).toContain('pg_catalog.scale("amount") <= 2');
    expect(schema).toContain('pg_catalog.abs("amount") < 1000000000000000000');
    expect(actions).toContain('ML_VALIDATION:money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount');
    expect(actions).toContain('v_request."amount" <= 10000');
    expect(actions).toContain("jsonb_build_object('currency', 'USD', 'amount'");
    expect(types).toContain("export interface Money<C extends string>");
    expect(types).toContain('amount: Money<"USD">;');
    expect(client).toContain('moneyAmount(input.amount, "USD", 20, 2');
    expect(output["typescript/errors.ts"]).toContain("class ValidationError");
    expect(output["enforcement.md"]).toContain("money:field:fld_9810e7598584487ea4a883e3c1c3f8d1");
    expect(output["enforcement.md"]).toContain("money-parameter:parameter:action:act_1e35db0451b1461e941af6283d86dca2.amount");
  });

  it("validates money parameters on generated query boundaries", () => {
    const source = `model MoneyQueries version "0.8.0";
      entity User { id: UUID @id; }
      entity Invoice { id: UUID @id; amount: Money<USD>; }
      query under(caller actor: User, ceiling: Money<USD>) from Invoice as invoice {
        authorize true;
        where invoice.amount <= ceiling;
        orderBy invoice.id asc;
        limit 10;
      }`;
    const output = generateAll(compileText(source, "money-query.model"));
    expect(output["postgres/003_queries.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_money_queries"."under"("p_ceiling" numeric)');
    expect(output["postgres/003_queries.sql"]).toContain("ML_VALIDATION:money-parameter:parameter:query:under.ceiling");
    expect(output["typescript/types.ts"]).toContain('ceiling: Money<"USD">;');
    expect(output["typescript/client.ts"]).toContain('moneyAmount(input.ceiling, "USD", 20, 2');
    expect(output["enforcement.md"]).toContain("money-parameter:parameter:query:under.ceiling");
  });

  it("uses DEFAULT VALUES when a create effect assigns no fields", () => {
    const source = `model Tokens version "0.7.0";
      entity User { id: UUID @id; }
      entity Token {
        id: UUID @id @generated(uuid);
        createdAt: DateTime @generated(now);
      }
      entity Receipt { id: UUID @id @generated(uuid); }
      event TokenIssued payload Token;
      action issue(caller actor: User) -> Token {
        authorize true;
        create Token { }
        emit TokenIssued;
      }
      consumer recordIssue on TokenIssued(payload token: Token) -> Receipt {
        authorize true;
        create Receipt { }
      }`;
    const output = generateAll(compileText(source, "tokens.model"));
    expect(output["postgres/003_actions.sql"]).toContain('INSERT INTO "model_tokens"."token" DEFAULT VALUES');
    expect(output["postgres/003_actions.sql"]).toContain("RETURNING * INTO v_result");
    expect(output["postgres/003_consumers.sql"]).toContain('INSERT INTO "model_tokens"."receipt" DEFAULT VALUES RETURNING * INTO v_result');
  });

  it("lowers null checks as IS NULL and never = NULL", () => {
    const source = `model M version "1";
      entity User { id: UUID @id; }
      entity Item { id: UUID @id; owner: User?; invariant owner_optional: owner == null or owner != null; }
      action make(caller actor: User, id: UUID) -> Item {
        authorize true;
        create Item { id = id; owner = null; }
      }`;
    const sql = generateAll(compileText(source, "null.model"))["postgres/002_schema.sql"];
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("IS NOT NULL");
    expect(sql).not.toMatch(/(?:=|<>) NULL/);
  });

  it("enforces exclusive lower bounds and only writes snapshots when an action assigns them", () => {
    const source = `model M version "1";
      enum Role { EMPLOYEE }
      entity User { id: UUID @id; role: Role; }
      entity Record { id: UUID @id; amount: Decimal @minExclusive(0); roleAtWrite: Role? @snapshot; }
      action make(caller actor: User, id: UUID, amount: Decimal) -> Record {
        authorize true;
        create Record { id = id; amount = amount; }
      }`;
    const output = generateAll(compileText(source, "exclusive.model"));
    expect(output["postgres/002_schema.sql"]).toContain('"amount" > 0');
    expect(output["postgres/002_schema.sql"]).toContain("ck_record_amount_min_exclusive");
    expect(output["postgres/003_actions.sql"]).not.toMatch(/INSERT INTO "model_m"\."record" \([^)]*"role_at_write"/);
    expect(output["typescript/types.ts"]).toContain("Stored point-in-time snapshot");
  });

  it("never exposes an actor argument in SQL or TypeScript callable APIs", async () => {
    const output = generateAll(await procurement());
    const actions = output["postgres/003_actions.sql"];
    const queries = output["postgres/003_queries.sql"];
    const client = output["typescript/client.ts"];
    const types = output["typescript/types.ts"];
    expect(actions).not.toMatch(/"p_actor"/);
    expect(queries).not.toMatch(/"p_actor"/);
    expect(client).not.toMatch(/input\.actor|actor:/);
    expect(types).not.toMatch(/\n  actor:/);
    expect(actions).toContain('"resolve_principal"()');
    expect(queries).toContain('"resolve_principal"()');
    expect(output["postgres/002_schema.sql"]).toContain("session_user");
    expect(actions).toContain('v_actor."id" = v_request."requester_id"');
  });

  it("generates a transaction-scoped shared gateway without exposing principal IDs", async () => {
    const output = generateAll(await procurement());
    const roles = output["postgres/001_roles.sql"];
    const schema = output["postgres/002_schema.sql"];
    const grants = output["postgres/004_grants.sql"];
    const gateway = output["typescript/gateway.ts"];
    expect(roles).toContain("CREATE ROLE modellang_gateway NOLOGIN");
    expect(roles).toContain("GRANT modellang_app TO modellang_gateway");
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."gateway_principal_binding"');
    expect(schema).toContain('"issuer" text NOT NULL');
    expect(schema).toContain('"subject" text NOT NULL');
    expect(schema).toContain("pg_catalog.set_config('modellang.gateway_issuer', p_issuer, true)");
    expect(schema).toContain("FROM pg_catalog.pg_auth_members AS membership");
    expect(schema).toContain("identity_role.rolname = session_user");
    expect(grants).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."bind_gateway_identity"(text, text) TO modellang_gateway');
    expect(grants).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway');
    expect(grants).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "model_procurement_internal" FROM PUBLIC, modellang_app, modellang_gateway');
    expect(gateway).toContain('await connection.query("BEGIN")');
    expect(gateway).toContain('await connection.query("COMMIT")');
    expect(gateway).toContain('connection.query("ROLLBACK")');
    expect(gateway).not.toMatch(/principalId|principal_id/);
    expect(output["typescript/browser.ts"]).not.toContain("Gateway");
    expect(output["postgres/006_upgrade_0_12.sql"]).toContain("0.11 -> 0.12");
    expect(output["postgres/006_upgrade_0_12.sql"]).toContain("ML_MIGRATION_BASELINE:");
  });

  it("emits safe privileged functions and an execute-only application boundary", async () => {
    const output = generateAll(await procurement());
    expect(output["postgres/003_actions.sql"]).toContain("SECURITY DEFINER");
    expect(output["postgres/003_actions.sql"]).toContain("SET search_path = pg_catalog, pg_temp");
    expect(output["postgres/003_actions.sql"]).not.toContain("EXECUTE ");
    expect(output["postgres/003_queries.sql"]).toContain("SECURITY DEFINER");
    expect(output["postgres/003_queries.sql"]).toContain("SET search_path = pg_catalog, pg_temp");
    expect(output["postgres/004_grants.sql"]).toContain('REVOKE ALL ON TABLE "model_procurement"."purchase_request"');
    expect(output["postgres/004_grants.sql"]).not.toContain("GRANT SELECT");
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement"."my_requests"()');
  });

  it("generates fail-closed, deterministic, bounded query SQL and typed clients", async () => {
    const output = generateAll(await procurement());
    const sql = output["postgres/003_queries.sql"];
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "model_procurement"."my_requests"()');
    expect(sql).toContain('WHERE (((v_row."requester_id" = v_actor."id")) IS TRUE)');
    expect(sql).toContain('ORDER BY v_row."id" ASC, v_row."id" ASC');
    expect(sql).toContain("LIMIT 100");
    expect(sql).not.toMatch(/FOR (?:UPDATE|NO KEY UPDATE)/);
    expect(output["typescript/types.ts"]).toContain("export interface MyRequestsInput");
    expect(output["typescript/types.ts"]).not.toMatch(/interface MyRequestsInput \{\n  actor:/);
    expect(output["typescript/client.ts"]).toContain("async myRequests(input: MyRequestsInput): Promise<PurchaseRequest[]>");
  });

  it("enforces enum sets and lowers membership and snapshot copies", async () => {
    const output = generateAll(await procurement());
    const schema = output["postgres/002_schema.sql"];
    const actions = output["postgres/003_actions.sql"];
    expect(schema).toContain('"roles" text[] NOT NULL');
    expect(schema).toContain('CONSTRAINT "ck_user_roles_enum_set"');
    expect(schema).toContain('"roles" <@ ARRAY[\'EMPLOYEE\', \'MANAGER\', \'FINANCE\']::text[]');
    expect(schema).toContain('array_position("roles", NULL::text) IS NULL');
    expect(schema).toContain("array_positions(\"roles\", 'MANAGER')");
    expect(schema).toContain('CONSTRAINT "ck_purchase_request_approval_authority_matches_amount"');
    expect(schema).toContain("'MANAGER' = ANY(\"approved_by_roles\")");
    expect(schema).toContain('CONSTRAINT "ck_purchase_request_approver_differs_from_requester"');
    expect(actions).toContain("'EMPLOYEE' = ANY(v_actor.\"roles\")");
    expect(actions).toContain("'MANAGER' = ANY(v_actor.\"roles\")");
    expect(actions).toContain("'FINANCE' = ANY(v_actor.\"roles\")");
    expect(actions).toContain('v_actor."id" <> v_request."requester_id"');
    expect(actions).toContain('"approved_by_roles" = v_actor."roles"');
    expect(actions).toContain("'action:act_1e35db0451b1461e941af6283d86dca2'");
    expect(output["typescript/types.ts"]).toContain("roles: Role[];");
    expect(output["typescript/types.ts"]).toContain("approvedByRoles: Role[] | null;");
    expect(output["enforcement.md"]).toContain("enum-set:field:fld_b4b29a4d0d914ec0913e578da89e5dcb");
  });

  it("explains identity, locks, invariants, guards, effects, and privilege boundaries", async () => {
    const markdown = generateAll(await procurement())["enforcement.md"];
    for (const expected of [
      "boundary:principal_binding",
      "boundary:gateway_role",
      "boundary:gateway_identity",
      "boundary:gateway_audit",
      "boundary:migration_history",
      "invariant:inv_b70e8aa03e6d498f8b0bccf413636b19",
      "invariant:inv_91184dc547c24978a48362a679eeb836",
      "invariant:inv_f8c6cf86f9d64874ac4159766e522cb8",
      "snapshot:field:fld_577b4c94c9cd4b469aded37614712fba",
      "authorize:action:act_d39dbb883b5f4019b9027b85add3de47",
      "require:action:act_d39dbb883b5f4019b9027b85add3de47.is_submitted",
      "lock:action:act_d39dbb883b5f4019b9027b85add3de47.request",
      "boundary:entity:ent_9bc680209327484c8e98f5f740bcc702.direct_write",
      "boundary:entity:ent_9bc680209327484c8e98f5f740bcc702.direct_read",
      "where:query:qry_4406b045404a48449282db804f6167a8",
      "order:query:qry_4406b045404a48449282db804f6167a8",
      "limit:query:qry_4406b045404a48449282db804f6167a8",
      "read:query:qry_4406b045404a48449282db804f6167a8",
      "failure-policy:consumer:con_10d694c9a0a274dc79c6168e47d25968",
      "boundary:audit",
    ]) expect(markdown).toContain(expected);
  });

  it("generates database workflow backstops, typed metadata, and lifecycle diagrams", async () => {
    const output = generateAll(await procurement());
    const schema = output["postgres/002_schema.sql"];
    expect(schema).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."enforce_purchase_request_lifecycle"()');
    expect(schema).toContain('CREATE TABLE "model_procurement_internal"."schema_migrations"');
    expect(schema).toContain('"migration_kind" text NOT NULL');
    expect(schema).toContain('"plan_hash" text');
    expect(schema).toContain("'installation'");
    expect(schema).toContain("VALUES ('model:Procurement', '0.23.0'");
    expect(schema).toContain("IF TG_OP = 'INSERT' THEN");
    expect(schema).toContain("ML_WORKFLOW:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87");
    expect(schema).toContain('AFTER INSERT ON "model_procurement"."purchase_request"');
    expect(schema).toContain('BEFORE UPDATE OF "status" ON "model_procurement"."purchase_request"');
    expect(schema).toContain('(OLD."status" = \'DRAFT\' AND NEW."status" = \'SUBMITTED\')');
    expect(schema).toContain('(OLD."status" = \'SUBMITTED\' AND NEW."status" = \'APPROVED\')');
    expect(output["typescript/errors.ts"]).toContain("class TransitionError");
    expect(output["typescript/workflows.ts"]).toContain("export const PurchaseRequestLifecycle");
    expect(output["typescript/workflows.ts"]).toContain('{ name: "approve", from: "SUBMITTED", to: "APPROVED", action: "approveRequest" }');
    expect(output["typescript/index.ts"]).toContain('export * from "./workflows.js"');
    expect(output["model.mmd"]).toContain("submit via submitRequest");
    expect(output["model.mmd"]).toContain("approve via approveRequest");
    expect(output["enforcement.md"]).toContain("workflow-initial:workflow:wfl_96a1115ba9bf42f2a206374822eeaa87");
    expect(output["enforcement.md"]).toContain("transition:trn_efd18c8576154ba8b138c97b551afae3");
  });

  it("generates a private atomic outbox, execute-only dispatcher, and typed event contracts", async () => {
    const output = generateAll(await procurement());
    const contract = JSON.parse(output["events.json"]!);
    const schema = JSON.parse(await readFile("schemas/event-manifest.schema.json", "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(contract), JSON.stringify(validate.errors)).toBe(true);
    expect(contract).toMatchObject({
      eventManifestVersion: 3,
      delivery: { semantics: "atLeastOnce", storage: "privateTransactionalOutbox", acknowledgement: "leaseToken" },
    });
    expect(contract.events).toHaveLength(4);
    expect(output["postgres/001_roles.sql"]).toContain("modellang_dispatcher NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_outbox"');
    expect(output["postgres/002_schema.sql"]).toContain("FOR UPDATE SKIP LOCKED LIMIT p_limit");
    expect(output["postgres/002_schema.sql"]).toContain('COALESCE(row_value."action_audit_id", row_value."consumer_audit_id"), row_value."ordinal", row_value."id"');
    expect(output["postgres/003_actions.sql"]).toContain('INSERT INTO "model_procurement_internal"."event_outbox"');
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"');
    expect(output["postgres/010_upgrade_0_20.sql"]).toContain("transactional domain-event upgrade");
    expect(output["typescript/events.ts"]).toContain("export type RequestOpenedEvent");
    expect(output["typescript/index.ts"]).toContain('export * from "./events.js"');
    expect(output["model.mmd"]).toContain("emits atomically");
  });

  it("generates private transactional inbox consumers without widening public discovery", async () => {
    const output = generateAll(await procurement());
    const semantic = JSON.parse(output["semantic.json"]!) as { consumers: { name: string; emittedEventIds: string[]; failurePolicy: object }[] };
    expect(semantic.consumers).toEqual([expect.objectContaining({
      name: "observeRequestApproval",
      emittedEventIds: ["event:evt_50d694c9a0a274dc79c6168e47d25968"],
      failurePolicy: { mode: "deadLetterAfterMaxAttempts", maxAttempts: 3 },
    })]);
    for (const publicArtifact of ["operations.json", "capabilities.json", "ui.json", "openapi.json"]) {
      expect(output[publicArtifact]).not.toContain("observeRequestApproval");
      expect(output[publicArtifact]).not.toContain("event_inbox");
    }
    expect(output["postgres/001_roles.sql"]).toContain("modellang_consumer NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_inbox"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_audit"');
    expect(output["postgres/003_consumers.sql"]).toContain('ON CONFLICT ("consumer_id", "source_event_id") DO NOTHING');
    expect(output["postgres/003_consumers.sql"]).toContain("p_envelope - 'deliveryAttempt'");
    expect(output["postgres/003_consumers.sql"]).toContain("p_envelope := p_envelope || pg_catalog.jsonb_build_object('consumerId', NULL)");
    expect(output["postgres/003_consumers.sql"]).toContain("ML_EVENT_CONFLICT");
    expect(output["postgres/003_consumers.sql"]).toContain("ML_CONSUMER_DEAD_LETTER");
    expect(output["postgres/003_consumers.sql"]).toContain("pg_advisory_xact_lock");
    expect(output["postgres/003_consumers.sql"]).toContain("v_source_event_id::text, v_consumer_audit_id, 0");
    expect(output["postgres/003_consumers.sql"]).toContain("'consumer:con_10d694c9a0a274dc79c6168e47d25968'");
    expect(output["postgres/002_schema.sql"]).toContain('"consumer_id" text');
    expect(output["postgres/002_schema.sql"]).toContain('CONSTRAINT "ck_event_outbox_producer"');
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."consume_observe_request_approval"');
    expect(output["typescript/consumers.ts"]).toContain("consumeObserveRequestApproval");
    expect(output["typescript/consumers.ts"]).toContain("deliverObserveRequestApproval");
    expect(output["typescript/consumers.ts"]).toContain('status: "retry" | "deadLetter"');
    expect(output["typescript/consumers.ts"]).toContain("record_consumer_failure");
    expect(output["postgres/011_upgrade_0_21.sql"]).toContain("reliable typed event-consumer upgrade");
    expect(output["postgres/012_upgrade_0_22.sql"]).toContain("transactional event-chain upgrade");
    expect(output["postgres/013_upgrade_0_23.sql"]).toContain("durable consumer-failure disposition upgrade");
    expect(output["postgres/002_schema.sql"]).toContain('"disposition" text NOT NULL DEFAULT \'retry\'');
    expect(output["postgres/002_schema.sql"]).toContain('"consumer_failure_state"');
    expect(output["model.mmd"]).toContain("consumer_con_10d694c9a0a274dc79c6168e47d25968 -->|emits atomically| event_evt_50d694c9a0a274dc79c6168e47d25968");

    const eventManifest = JSON.parse(output["events.json"]!) as { delivery: { envelopeVersion: number }; events: { name: string; emittedByConsumerIds: string[] }[] };
    expect(eventManifest.delivery.envelopeVersion).toBe(2);
    expect(eventManifest.events.find((event) => event.name === "ApprovalObserved")?.emittedByConsumerIds)
      .toEqual(["consumer:con_10d694c9a0a274dc79c6168e47d25968"]);
    expect(output["typescript/events.ts"]).toContain('{ readonly actionId: null; readonly consumerId: string }');

    const sourceHash = `sha256:${"c".repeat(64)}`;
    const imported = generateAll(compileText(`model ImportedConsumer version "1";
      entity User { id: UUID @id; }
      entity Item { id: UUID @id; observed: Boolean = false; }
      event ItemChanged payload Item from "model:Producer" version "2.3.4" sourceHash "${sourceHash}";
      action touch(caller actor: User, item: Item) -> Item {
        authorize true;
        update item { observed = false; }
      }
      consumer observe on ItemChanged(payload item: Item) -> Item {
        authorize true;
        update item { observed = true; }
      }`, "imported-consumer.model"));
    expect(JSON.parse(imported["events.json"]!).events[0].source).toEqual({
      kind: "imported",
      modelId: "model:Producer",
      modelVersion: "2.3.4",
      sourceHash,
    });
    expect(imported["postgres/003_consumers.sql"]).toContain("v_source_model_id IS DISTINCT FROM 'model:Producer'");
    expect(imported["postgres/003_consumers.sql"]).toContain(`v_source_hash IS DISTINCT FROM '${sourceHash}'`);
    expect(imported["typescript/events.ts"]).toContain(`"model:Producer", "2.3.4", "${sourceHash}"`);
  });
});
