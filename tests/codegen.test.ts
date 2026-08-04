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
      projections: { id: string; name: string; fields: { name: string; nestedProjectionId?: string }[] }[];
      operations: { id: string; kind: string; name: string; input: { name: string }[]; caller: { requestSupplied: boolean }; output: { projectionId?: string }; reliability?: { idempotency: string } }[];
      workflows: { id: string; transitions: { id: string; actionId: string; target: object }[] }[];
    };
    const schema = JSON.parse(await readFile("schemas/operation-manifest.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.manifestVersion).toBe(11);
    expect(manifest.authentication).toEqual(expect.objectContaining({
      source: "authenticatedContext",
      requestSupplied: false,
    }));
    expect(manifest.entities.find((entity) => entity.name === "PurchaseRequest")?.idFieldId)
      .toBe("field:fld_af918d24406040619a77b244a81ca5d3");
    expect(manifest.projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "projection:prj_76d694c9a0a274dc79c6168e47d25968", name: "UserSummary" }),
      expect.objectContaining({
        id: "projection:prj_70d694c9a0a274dc79c6168e47d25968",
        name: "RequestSummary",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "amount" }),
          expect.objectContaining({
            name: "approvedBy",
            nestedProjectionId: "projection:prj_76d694c9a0a274dc79c6168e47d25968",
          }),
        ]),
      }),
    ]));
    expect(manifest.operations).toHaveLength(4);
    for (const operation of manifest.operations) {
      expect(operation.caller.requestSupplied).toBe(false);
      expect(operation.input.map((parameter) => parameter.name)).not.toContain("actor");
    }
    expect(manifest.operations.find((operation) => operation.name === "openRequest")?.reliability)
      .toMatchObject({ idempotency: "required" });
    expect(manifest.operations.find((operation) => operation.name === "submitRequest")?.reliability)
      .toMatchObject({ idempotency: "unsupported" });
    expect(manifest.operations.find((operation) => operation.name === "myRequests")?.output)
      .toEqual({ projectionId: "projection:prj_70d694c9a0a274dc79c6168e47d25968", cardinality: "many", maxItems: 100 });
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
      paths: Record<string, { post: { summary: string; parameters: { $ref: string }[]; requestBody: { content: { "application/json": { schema: { additionalProperties: boolean; properties: Record<string, unknown> } } } }; "x-modellang-read-evidence"?: object } }>;
      components: {
        parameters: Record<string, { name: string; required: boolean }>;
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
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
    expect(openapi.paths["/operations/queries/qry_4406b045404a48449282db804f6167a8"]?.post["x-modellang-read-evidence"]).toMatchObject({
      mode: "transactionalAudit",
      storage: "private",
      payloadRetention: "none",
    });
    expect(openapi.components.parameters.IdempotencyKey).toMatchObject({ name: "Idempotency-Key", required: true });
    expect(openapi.components.parameters.CorrelationId).toMatchObject({ name: "X-Correlation-ID", required: false });
    expect(openapi.components.parameters.CausationId).toMatchObject({ name: "X-Causation-ID", required: false });
    expect(openapi.components.schemas.RequestSummary?.properties?.approvedBy).toEqual({
      anyOf: [
        { $ref: "#/components/schemas/UserSummary" },
        { type: "null" },
      ],
    });

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
      projections: { id: string; fields: { name: string; nestedProjectionId?: string; redactable?: true }[] }[];
      queries: { disclosures?: { id: string; projectionFieldPath: string[] }[]; readEvidence?: { mode: string; storage: string; payloadRetention: string; revision: string }; disclosureSet: { projectionIds: string[]; projectionFieldIds: string[]; sourceFieldIds: string[] } }[];
      extensions: { id: string; execution: string }[];
    };
    const semanticSchema = JSON.parse(await readFile("schemas/semantic-manifest.schema.json", "utf8")) as object;
    const validateSemantic = new Ajv2020({ allErrors: true, strict: true }).compile(semanticSchema);
    expect(validateSemantic(semantic), JSON.stringify(validateSemantic.errors)).toBe(true);
    expect(semantic).toMatchObject({
      manifestVersion: 18,
      audience: "engineering",
      view: { authorizationFiltered: false, currentState: false, executable: false },
      provenance: { compilerVersion: packageInfo.version, irVersion: 1 },
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
    expect(semantic.projections.find((projection) => projection.id === "projection:prj_70d694c9a0a274dc79c6168e47d25968")?.fields)
      .toContainEqual(expect.objectContaining({
        name: "approvedBy",
        nestedProjectionId: "projection:prj_76d694c9a0a274dc79c6168e47d25968",
      }));
    expect(semantic.queries[0]!.disclosureSet.projectionIds).toEqual([
      "projection:prj_70d694c9a0a274dc79c6168e47d25968",
      "projection:prj_76d694c9a0a274dc79c6168e47d25968",
    ]);
    expect(semantic.queries[0]!.disclosures).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^disclose:query:/),
        projectionFieldPath: ["projectionField:pfd_73d694c9a0a274dc79c6168e47d25968"],
      }),
    ]);
    expect(semantic.queries[0]!.readEvidence).toMatchObject({
      mode: "transactionalAudit",
      storage: "private",
      payloadRetention: "none",
      revision: expect.stringMatching(/^sha256:/),
    });
    expect(semantic.extensions).toEqual([
      expect.objectContaining({ id: "extension:ext_54d694c9a0a274dc79c6168e47d25968", execution: "externalDeclarationOnly" }),
    ]);

    const extensions = JSON.parse(output["extensions.json"]!) as { ledgerVersion: number; public: boolean; executable: boolean; extensions: { id: string }[]; summary: object };
    const extensionSchema = JSON.parse(await readFile("schemas/extension-ledger.schema.json", "utf8")) as object;
    const validateExtensions = new Ajv2020({ allErrors: true, strict: true }).compile(extensionSchema);
    expect(validateExtensions(extensions), JSON.stringify(validateExtensions.errors)).toBe(true);
    expect(extensions).toMatchObject({
      ledgerVersion: 1,
      public: false,
      executable: false,
      summary: { declared: 1, externallyImplemented: 1, generatedImplementations: 0 },
    });

    const target = JSON.parse(output["target-capabilities.json"]!) as { profileVersion: number; targetProfile: string; conformance: string; authority: string; capabilities: { id: string; support: string }[]; gaps: { extensionId: string }[] };
    const targetSchema = JSON.parse(await readFile("schemas/target-capability-profile.schema.json", "utf8")) as object;
    const validateTarget = new Ajv2020({ allErrors: true, strict: true }).compile(targetSchema);
    expect(validateTarget(target), JSON.stringify(validateTarget.errors)).toBe(true);
    expect(target).toMatchObject({
      profileVersion: 2,
      targetProfile: "target:postgresql-http-ui-agent-catalog/2",
      conformance: "requiresExternalImplementations",
      authority: "none",
      gaps: [{ extensionId: "extension:ext_54d694c9a0a274dc79c6168e47d25968" }],
    });
    expect(target.capabilities).toContainEqual({
      id: "agents.staticToolCatalog",
      required: true,
      support: "native",
      enforcement: ["agent-tool-catalog", "http"],
    });
    for (const path of ["operations.json", "capabilities.json", "openapi.json", "ui.json"]) {
      expect(output[path]).not.toContain("extension:ext_54d694c9a0a274dc79c6168e47d25968");
      expect(output[path]).not.toContain("supplier-risk/review");
    }
    expect(output["postgres/003_actions.sql"]).not.toContain("supplier-risk/review");
    expect(output["typescript/client.ts"]).not.toContain("supplierRiskReview");
    const reservationTarget = JSON.parse(generateAll(await reservations())["target-capabilities.json"]!);
    expect(reservationTarget).toMatchObject({ conformance: "complete", gaps: [] });

    const provenance = JSON.parse(output["provenance.json"]!) as {
      provenanceVersion: number;
      compilerVersion: string;
      targetProfile: string;
      irVersion: number;
      artifacts: { path: string; role: string; sha256: string }[];
    };
    const provenanceSchema = JSON.parse(await readFile("schemas/artifact-provenance.schema.json", "utf8")) as object;
    const validateProvenance = new Ajv2020({ allErrors: true, strict: true }).compile(provenanceSchema);
    expect(validateProvenance(provenance), JSON.stringify(validateProvenance.errors)).toBe(true);
    expect(provenance).toMatchObject({ provenanceVersion: 2, compilerVersion: packageInfo.version, irVersion: 1, targetProfile: "target:postgresql-http-ui-agent-catalog/2" });
    expect(provenance.artifacts.some((artifact) => artifact.path === "provenance.json")).toBe(false);
    const operation = provenance.artifacts.find((artifact) => artifact.path === "operations.json")!;
    expect(operation.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "decisions.json")?.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "capabilities.json")?.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "agent-tools.json")?.role).toBe("contract");
    expect(provenance.artifacts.find((artifact) => artifact.path === "extensions.json")?.role).toBe("assurance");
    expect(provenance.artifacts.find((artifact) => artifact.path === "target-capabilities.json")?.role).toBe("assurance");
    expect(operation.sha256).toBe(`sha256:${createHash("sha256").update(output["operations.json"]!, "utf8").digest("hex")}`);
  });

  it("emits a static, closed, non-authoritative agent tool catalog", async () => {
    const output = generateAll(await procurement());
    const catalog = JSON.parse(output["agent-tools.json"]!) as {
      catalogVersion: number;
      operationManifestVersion: number;
      capabilityManifestVersion: number;
      view: Record<string, boolean | string>;
      adapter: { compatibility: string; directProtocolConformance: boolean };
      authentication: { required: boolean; source: string; callerInput: boolean };
      tools: {
        id: string;
        kind: "action" | "query";
        name: string;
        inputSchema: { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
        outputSchema: Record<string, unknown>;
        execution: { method: string; path: string; authenticated: boolean; runtimeAuthorizationRequired: boolean };
        applicability?: { path: string; outcomes: string[]; authorizationRuleId: string; preconditionRuleIds: string[]; grantsAuthority: boolean };
        reliability?: { idempotency: string };
        emittedEventIds?: string[];
        bounds?: { cardinality: string; maxItems: number };
        annotations: { readOnly: boolean };
      }[];
    };
    const schema = JSON.parse(await readFile("schemas/agent-tool-catalog.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(catalog), JSON.stringify(validate.errors)).toBe(true);
    expect(catalog).toMatchObject({
      catalogVersion: 1,
      operationManifestVersion: 11,
      capabilityManifestVersion: 10,
      view: {
        audience: "agent",
        static: true,
        authorizationFiltered: false,
        containsExpressions: false,
        containsCurrentState: false,
        containsExtensions: false,
        grantsAuthority: false,
        runtimeAuthorizationRequired: true,
      },
      adapter: { compatibility: "mcpTool", directProtocolConformance: false },
      authentication: { required: true, source: "authenticatedContext", callerInput: false },
    });
    expect(catalog.tools).toHaveLength(4);
    for (const tool of catalog.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).not.toHaveProperty("actor");
      expect(tool.execution).toMatchObject({ method: "POST", authenticated: true, runtimeAuthorizationRequired: true });
      expect(tool.execution.path).toMatch(new RegExp(`^/operations/${tool.kind === "action" ? "actions" : "queries"}/`));
      expect(tool.annotations.readOnly).toBe(tool.kind === "query");
      const schemaValidator = new Ajv2020({
        allErrors: true,
        strict: true,
        formats: { uuid: true, "date-time": true },
      });
      expect(() => schemaValidator.compile(tool.inputSchema)).not.toThrow();
      expect(() => schemaValidator.compile(tool.outputSchema)).not.toThrow();
    }
    const open = catalog.tools.find((tool) => tool.name === "openRequest")!;
    expect(open).toMatchObject({
      kind: "action",
      reliability: { idempotency: "required" },
      emittedEventIds: ["event:evt_10d694c9a0a274dc79c6168e47d25968"],
      applicability: {
        path: "/operations/actions/act_1e35db0451b1461e941af6283d86dca2/applicability",
        outcomes: ["applicable", "denied", "notApplicable", "stale"],
        authorizationRuleId: "authorize:action:act_1e35db0451b1461e941af6283d86dca2",
        grantsAuthority: false,
      },
    });
    const query = catalog.tools.find((tool) => tool.name === "myRequests")!;
    expect(query).toMatchObject({ kind: "query", bounds: { cardinality: "many", maxItems: 100 } });
    expect(JSON.stringify(query.outputSchema)).not.toContain("$ref");
    expect(JSON.stringify(catalog)).not.toMatch(/supplier-risk\/review|extension:|expression|sqlFunction|currentValue|commandReceipt|event_outbox|query_audit/);

    const reservationCatalog = JSON.parse(generateAll(await reservations())["agent-tools.json"]!) as typeof catalog;
    expect(validate(reservationCatalog), JSON.stringify(validate.errors)).toBe(true);
    const paged = reservationCatalog.tools.find((tool) => tool.name === "reservationsForResource")!;
    expect(paged).toMatchObject({
      kind: "query",
      bounds: { cardinality: "page", maxItems: 2 },
      inputSchema: {
        additionalProperties: false,
        properties: {
          sort: { type: "string", enum: ["default", "latestFirst", "endingSoonest"] },
          cursor: { type: "string", minLength: 1, maxLength: 4096, pattern: "^[A-Za-z0-9_-]+$" },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["items", "nextCursor"],
        properties: { items: { type: "array", maxItems: 2 } },
      },
    });
  });

  it("derives a schema-valid framework-neutral UI manifest from the operation boundary", async () => {
    const output = generateAll(await procurement());
    const manifest = JSON.parse(output["ui.json"]!) as {
      uiManifestVersion: number;
      operationManifestVersion: number;
      authentication: { required: boolean; callerInput: boolean };
      enums: { name: string; label: string; options: { value: string; label: string }[] }[];
      entities: { name: string; idFieldId: string; fields: { name: string; generated?: string; snapshot: boolean; presentation: object }[] }[];
      projections: { name: string; fields: { name: string; nestedProjectionId?: string }[] }[];
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
      uiManifestVersion: 11,
      operationManifestVersion: 11,
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
      resultProjectionId: "projection:prj_70d694c9a0a274dc79c6168e47d25968",
      label: "My requests",
      filters: [],
      maxItems: 100,
    });
    expect(manifest.projections.find((projection) => projection.name === "RequestSummary")?.fields)
      .toContainEqual(expect.objectContaining({
        name: "approvedBy",
        nestedProjectionId: "projection:prj_76d694c9a0a274dc79c6168e47d25968",
      }));
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

  it("publishes only query-reachable projections and keeps shape reuse independent from query policy", () => {
    const ir = compileText(`model ProjectionReachability version "1";
entity User { id: UUID @id; }
entity Record { id: UUID @id; owner: User; archived: Boolean; }
projection RecordSummary from Record { id; }
projection UnusedRecordDetail from Record { id; archived; }
query owned(caller actor: User) returns RecordSummary from Record as row {
  authorize true; where row.owner == actor; orderBy row.id asc; limit 10;
}
query active(caller actor: User) returns RecordSummary from Record as row {
  authorize true; where row.archived == false; orderBy row.id asc; limit 10;
}`, "projection-reachability.model");
    const output = generateAll(ir);
    const operations = JSON.parse(output["operations.json"]!) as { projections: { name: string }[] };
    expect(operations.projections).toEqual([{ name: "RecordSummary", id: "projection:RecordSummary", sourceEntityId: "entity:Record", fields: [
      { id: "projectionField:RecordSummary.id", name: "id", sourceFieldId: "field:Record.id", type: { kind: "scalar", name: "UUID" }, nullable: false },
    ] }]);
    expect(output["postgres/003_queries.sql"]).toContain('WHERE (((v_row."owner_id" = v_actor."id")) IS TRUE)');
    expect(output["postgres/003_queries.sql"]).toContain('WHERE (((v_row."archived" = FALSE)) IS TRUE)');
    expect(output["postgres/003_queries.sql"]).not.toContain("'owner'");
    expect(output["postgres/003_queries.sql"]).not.toContain("'archived'");
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
      projection InvoiceSummary from Invoice { id; amount; }
      query under(caller actor: User, ceiling: Money<USD>) returns InvoiceSummary from Invoice as invoice {
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

  it("skips optional money validation and entity loading only for null query inputs", () => {
    const source = `model OptionalQueryInputs version "0.37.0";
      entity User { id: UUID @id; }
      entity Vendor { id: UUID @id; }
      entity Invoice { id: UUID @id; vendor: Vendor; amount: Money<USD>; }
      projection InvoiceSummary from Invoice { id; amount; }
      query under(caller actor: User, vendor: Vendor?, ceiling: Money<USD>?) returns InvoiceSummary from Invoice as invoice {
        authorize true;
        where (vendor == null or invoice.vendor == vendor) and (ceiling == null or invoice.amount <= ceiling);
        orderBy invoice.id asc;
        limit 10;
      }`;
    const output = generateAll(compileText(source, "optional-query-inputs.model"));
    const sql = output["postgres/003_queries.sql"];
    expect(sql).toContain('IF "p_vendor" IS NOT NULL THEN');
    expect(sql).toContain('IF "p_ceiling" IS NOT NULL AND NOT');
    expect(sql).toContain('ML_AUTHORIZATION:authorize:query:under');
    expect(output["typescript/types.ts"]).toContain('vendor?: string | null;');
    expect(output["typescript/types.ts"]).toContain('ceiling?: Money<"USD"> | null;');
    expect(output["typescript/client.ts"]).toContain('input.ceiling == null ? null : moneyAmount(input.ceiling');
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
    expect(types).not.toMatch(/\n {2}actor:/);
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
    expect(output["typescript/types.ts"]).not.toMatch(/interface MyRequestsInput \{\n {2}actor:/);
    expect(output["typescript/types.ts"]).toContain("export interface RequestSummary");
    expect(output["typescript/types.ts"]).toContain("export interface UserSummary");
    expect(output["typescript/types.ts"]).toContain('amount: Money<"USD"> | null;');
    expect(output["typescript/types.ts"]).toContain("approvedBy: UserSummary | null;");
    expect(output["typescript/client.ts"]).toContain("async myRequests(input: MyRequestsInput): Promise<RequestSummary[]>");
    expect(sql).toContain('FROM "model_procurement"."user" AS "v_projection_4"');
    expect(sql).toContain('WHERE "v_projection_4"."id" = v_row."approved_by_id"');
    expect(sql).not.toContain("'requester'");
    expect(sql).not.toContain("'approvedByRoles'");
    expect(sql).toContain(`'amount', CASE WHEN (((v_row."status" <> 'DRAFT')) IS TRUE)`);
    expect(sql).toContain("ELSE NULL END");
    const operations = JSON.parse(output["operations.json"]!) as {
      projections: { name: string; fields: { name: string; nullable: boolean; redactable?: true }[] }[];
      operations: {
        name: string;
        disclosure?: { redaction: string; default: string; fields: { projectionFieldPath: string[]; ruleId?: string }[] };
        readEvidence?: { mode: string; scope: string; storage: string; requestBinding: string; responseBinding: string; payloadRetention: string; revision: string };
      }[];
    };
    expect(operations.projections.find((projection) => projection.name === "RequestSummary")?.fields)
      .toContainEqual(expect.objectContaining({ name: "amount", nullable: true, redactable: true }));
    expect(operations.operations.find((operation) => operation.name === "myRequests")?.disclosure).toMatchObject({
      redaction: "null",
      default: "redacted",
      fields: [expect.objectContaining({
        projectionFieldPath: ["projectionField:pfd_73d694c9a0a274dc79c6168e47d25968"],
        ruleId: expect.stringMatching(/^disclose:query:/),
      })],
    });
    expect(operations.operations.find((operation) => operation.name === "myRequests")?.readEvidence).toEqual({
      mode: "transactionalAudit",
      scope: "successfulCommittedExecution",
      storage: "private",
      requestBinding: "canonicalSha256",
      responseBinding: "canonicalSha256",
      payloadRetention: "none",
      revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."query_audit"');
    expect(sql).toContain('INSERT INTO "model_procurement_internal"."query_audit"');
    expect(sql).toContain("pg_catalog.sha256(pg_catalog.convert_to");
    expect(output["postgres/002_schema.sql"]).not.toMatch(/request_payload|response_payload|raw_input|raw_cursor/);
    expect(generateAll(await reservations())["postgres/003_queries.sql"]).not.toContain('INSERT INTO "model_reservations_internal"."query_audit"');
  });

  it("redacts absent rules and statically lowers nested disclosure paths", () => {
    const ir = compileText(`model DisclosureDefaults version "1";
      entity User { id: UUID @id; role: String; }
      entity Item { id: UUID @id; owner: User; value: String; }
      projection UserSummary from User { id; role redactable; }
      projection ItemSummary from Item { id; value redactable; owner: UserSummary redactable; }
      query items(caller actor: User) returns ItemSummary from Item as item {
        authorize true;
        where item.owner == actor;
        disclose owner when item.owner == actor;
        disclose owner.role when item.owner == actor;
        orderBy item.id asc;
        limit 10;
      }`, "disclosure-defaults.model");
    const output = generateAll(ir);
    const sql = output["postgres/003_queries.sql"]!;
    expect(sql).toContain("'value', NULL");
    expect(sql).toContain("'owner', CASE WHEN (((v_row.\"owner_id\" = v_actor.\"id\")) IS TRUE)");
    expect(sql).toContain("'role', CASE WHEN (((v_row.\"owner_id\" = v_actor.\"id\")) IS TRUE)");
    expect(output["typescript/types.ts"]).toContain("value: string | null;");
    expect(output["typescript/types.ts"]).toContain("owner: UserSummary | null;");
    expect(output["typescript/types.ts"]).toContain("role: string | null;");

    const operations = JSON.parse(output["operations.json"]!) as {
      operations: { name: string; disclosure?: { fields: { projectionFieldPath: string[]; ruleId?: string }[] } }[];
    };
    const fields = operations.operations.find((operation) => operation.name === "items")!.disclosure!.fields;
    expect(fields).toHaveLength(3);
    expect(fields.find((field) => field.projectionFieldPath.at(-1)?.endsWith(".value"))).not.toHaveProperty("ruleId");
    expect(fields.filter((field) => field.ruleId)).toHaveLength(2);
  });

  it("generates opaque keyset cursor pages bound to query and filter identity", async () => {
    const output = generateAll(await reservations());
    const sql = output["postgres/003_queries.sql"];
    expect(sql).toContain('"reservations_for_resource"("p_resource" uuid, "p_starts_at_or_after" timestamptz, p_sort text DEFAULT NULL, p_cursor text DEFAULT NULL)');
    expect(sql).toContain('("p_starts_at_or_after" IS NULL) OR (v_row."starts_at" >= "p_starts_at_or_after")');
    expect(sql).toContain("'modelVersion', '0.38.0'");
    expect(sql).toContain("'sourceHash'");
    expect(sql).toContain("'queryId'");
    expect(sql).toContain("'revision'");
    expect(sql).toContain("'inputHash', v_input_hash");
    expect(sql).toContain("'caller', pg_catalog.to_jsonb(v_principal_id)");
    expect(sql).toContain("v_sort_profile NOT IN ('default', 'latestFirst', 'endingSoonest')");
    expect(sql).toContain('v_row."starts_at" > v_cursor_sort::timestamptz');
    expect(sql).toContain('v_row."starts_at" < v_cursor_sort::timestamptz');
    expect(sql).toContain("'sortProfile', pg_catalog.to_jsonb(v_sort_profile)");
    expect(sql).toContain('v_row."id" > v_cursor_identity');
    expect(sql).toContain("LIMIT 3");
    expect(sql).not.toMatch(/\bOFFSET\b/);
    expect(sql).toContain("ML_VALIDATION:cursor:query:");
    expect(sql).toContain("ML_STALE:cursor:query:");

    expect(output["typescript/types.ts"]).toContain("export interface CursorPage<T>");
    expect(output["typescript/types.ts"]).toContain("startsAtOrAfter?: string | null;");
    expect(output["typescript/types.ts"]).toContain('sort?: "default" | "latestFirst" | "endingSoonest";');
    expect(output["typescript/types.ts"]).toContain("cursor?: string;");
    expect(output["typescript/client.ts"]).toContain("Promise<CursorPage<ReservationSummary>>");

    const operations = JSON.parse(output["operations.json"]!) as {
      operations: { kind: string; name: string; errors: string[]; input: { name: string; optional?: true }[]; sorting?: object; output: Record<string, unknown> }[];
    };
    const reservationQuery = operations.operations.find((operation) => operation.name === "reservationsForResource")!;
    expect(reservationQuery).toMatchObject({
      errors: ["identityBinding", "authorization", "validation", "stale"],
      input: [
        expect.objectContaining({ name: "resource" }),
        expect.objectContaining({ name: "startsAtOrAfter", optional: true }),
      ],
      sorting: {
        input: "sort",
        defaultProfile: "default",
        profiles: [
          expect.objectContaining({ name: "default", direction: "asc" }),
          expect.objectContaining({ name: "latestFirst", direction: "desc" }),
          expect.objectContaining({ name: "endingSoonest", direction: "asc" }),
        ],
      },
      output: {
        cardinality: "page",
        maxItems: 2,
        pagination: {
          kind: "cursor",
          cursorVersion: 1,
          cursorInput: "cursor",
          queryRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      },
    });
    const openapi = JSON.parse(output["openapi.json"]!) as {
      paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: { required: string[]; properties: Record<string, unknown> } } } }; responses: { "200": { content: { "application/json": { schema: Record<string, unknown> } } } } } }>;
    };
    const route = openapi.paths["/operations/queries/qry_94d8a56f4c2640fab58a4c2190c35c69"]!.post;
    expect(route.requestBody.content["application/json"].schema.required).toEqual(["resource"]);
    expect(route.requestBody.content["application/json"].schema.properties).toHaveProperty("cursor");
    expect(route.requestBody.content["application/json"].schema.properties.sort).toMatchObject({
      enum: ["default", "latestFirst", "endingSoonest"],
    });
    expect(route.requestBody.content["application/json"].schema.properties.startsAtOrAfter).toMatchObject({
      anyOf: expect.arrayContaining([{ type: "null" }]),
    });
    expect(route.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
      required: ["items", "nextCursor"],
    });
    const uiQuery = JSON.parse(output["ui.json"]!).queries[0];
    expect(uiQuery.pagination).toMatchObject({ kind: "cursor", cursorInput: "cursor" });
    expect(uiQuery.sorting).toMatchObject({ input: "sort", defaultProfile: "default" });
    expect(uiQuery.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "startsAtOrAfter", required: false, nullable: true }),
    ]));
    const semanticQuery = JSON.parse(output["semantic.json"]!).queries[0];
    expect(semanticQuery.output.cardinality).toBe("page");
    expect(semanticQuery.sortProfiles).toHaveLength(2);
  });

  it("binds audited page evidence to filters, sorting, and continuation without retaining payloads", async () => {
    const source = await readFile("examples/reservations.model", "utf8");
    const audited = compileText(
      source.replace("  paginate cursor;", "  paginate cursor;\n  audit reads;"),
      "audited-reservations.model",
    );
    const output = generateAll(audited);
    const sql = output["postgres/003_queries.sql"]!;

    expect(sql).toContain('INSERT INTO "model_reservations_internal"."query_audit"');
    expect(sql).toContain("'inputs', pg_catalog.jsonb_build_object(");
    expect(sql).toContain("'cursor', pg_catalog.to_jsonb(p_cursor)");
    expect(sql).toContain("'sortProfile', pg_catalog.to_jsonb(v_sort_profile)");
    expect(sql).toContain("pg_catalog.jsonb_array_length(v_result -> 'items')");
    expect(sql).toContain("v_sort_profile, p_cursor IS NOT NULL");

    const operations = JSON.parse(output["operations.json"]!) as {
      operations: {
        name: string;
        readEvidence?: { revision: string };
        output: { pagination?: { queryRevision: string } };
      }[];
    };
    const operation = operations.operations.find((candidate) => candidate.name === "reservationsForResource")!;
    expect(operation.readEvidence?.revision).toBe(operation.output.pagination?.queryRevision);
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
    expect(schema).toContain("VALUES ('model:Procurement', '0.38.0'");
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
      eventManifestVersion: 5,
      delivery: { semantics: "atLeastOnce", storage: "privateTransactionalOutbox", acknowledgement: "leaseToken" },
    });
    expect(contract.events).toHaveLength(4);
    expect(contract.events[0].publicationFailurePolicy).toEqual({ mode: "deadLetterAfterMaxAttempts", maxAttempts: 5, recovery: "manual" });
    expect(output["postgres/001_roles.sql"]).toContain("modellang_dispatcher NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_outbox"');
    expect(output["postgres/002_schema.sql"]).toContain("FOR UPDATE SKIP LOCKED LIMIT p_limit");
    expect(output["postgres/002_schema.sql"]).toContain('"publication_failure_count" integer NOT NULL DEFAULT 0');
    expect(output["postgres/002_schema.sql"]).toContain('"publication_total_failure_count" integer NOT NULL DEFAULT 0');
    expect(output["postgres/002_schema.sql"]).toContain('"publication_recovery_mode" text NOT NULL DEFAULT \'none\'');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_recovery_audit"');
    expect(output["postgres/002_schema.sql"]).toContain('"publication_disposition" text NOT NULL DEFAULT \'pending\'');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."fail_event"');
    expect(output["postgres/002_schema.sql"]).toContain('WHERE row_value."publication_disposition" = \'pending\'');
    expect(output["postgres/002_schema.sql"]).toContain('COALESCE(row_value."action_audit_id", row_value."consumer_audit_id"), row_value."ordinal", row_value."id"');
    expect(output["postgres/003_actions.sql"]).toContain('INSERT INTO "model_procurement_internal"."event_outbox"');
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."claim_events"');
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."fail_event"');
    expect(output["postgres/004_grants.sql"]).toContain('GRANT EXECUTE ON FUNCTION "model_procurement_internal"."recover_event_publication"(uuid, text) TO modellang_publication_recovery');
    expect(output["typescript/events.ts"]).toContain("export type RequestOpenedEvent");
    expect(output["typescript/dispatcher.ts"]).toContain("claimProcurementEvents");
    expect(output["typescript/dispatcher.ts"]).toContain("acknowledgeProcurementEvent");
    expect(output["typescript/dispatcher.ts"]).toContain("failProcurementEvent");
    expect(output["typescript/dispatcher.ts"]).toContain('status: "retry" | "deadLetter"');
    expect(output["typescript/publication-recovery.ts"]).toContain("recoverProcurementEventPublication");
    expect(output["typescript/publication-recovery.ts"]).toContain('status: "recovered"');
    expect(output["typescript/index.ts"]).toContain('export * from "./events.js"');
    expect(output["typescript/index.ts"]).toContain('export * from "./dispatcher.js"');
    expect(output["typescript/index.ts"]).toContain('export * from "./publication-recovery.js"');
    expect(output["postgres/001_roles.sql"]).toContain("modellang_failure_observer NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."failure_observation_audit"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."observe_terminal_publications"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."observe_terminal_consumers"');
    expect(output["postgres/004_grants.sql"]).toContain('"observe_terminal_publications"(timestamptz, timestamptz, uuid, integer) TO modellang_failure_observer');
    expect(output["typescript/failure-observer.ts"]).toContain("observeProcurementTerminalPublications");
    expect(output["typescript/failure-observer.ts"]).toContain("observeProcurementTerminalConsumers");
    expect(output["typescript/index.ts"]).toContain('export * from "./failure-observer.js"');
    expect(output["postgres/001_roles.sql"]).toContain("modellang_failure_acknowledger NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_failure_acknowledgement"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_failure_acknowledgement"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."acknowledge_terminal_publication_failure"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."acknowledge_terminal_consumer_failure"');
    expect(output["postgres/002_schema.sql"]).toContain("'acknowledged', acknowledged");
    expect(output["postgres/004_grants.sql"]).toContain('"acknowledge_terminal_publication_failure"(uuid, text) TO modellang_failure_acknowledger');
    expect(output["postgres/004_grants.sql"]).toContain('"acknowledge_terminal_consumer_failure"(text, text, text) TO modellang_failure_acknowledger');
    expect(output["typescript/failure-acknowledgement.ts"]).toContain("acknowledgeProcurementTerminalPublication");
    expect(output["typescript/failure-acknowledgement.ts"]).toContain("acknowledgeProcurementTerminalConsumer");
    expect(output["typescript/failure-acknowledgement.ts"]).not.toContain("reason_code");
    expect(output["typescript/failure-acknowledgement.ts"]).not.toContain("database_principal");
    expect(output["typescript/index.ts"]).toContain('export * from "./failure-acknowledgement.js"');
    expect(output["postgres/001_roles.sql"]).toContain("modellang_failure_claimant NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."publication_failure_claim"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_failure_claim"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_terminal_publication_failure"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE OR REPLACE FUNCTION "model_procurement_internal"."claim_terminal_consumer_failure"');
    expect(output["postgres/002_schema.sql"]).toContain("'claimed', claimed");
    expect(output["postgres/004_grants.sql"]).toContain('"claim_terminal_publication_failure"(uuid) TO modellang_failure_claimant');
    expect(output["postgres/004_grants.sql"]).toContain('"claim_terminal_consumer_failure"(text, text) TO modellang_failure_claimant');
    expect(output["typescript/failure-claim.ts"]).toContain("claimProcurementTerminalPublication");
    expect(output["typescript/failure-claim.ts"]).toContain("claimProcurementTerminalConsumer");
    expect(output["typescript/failure-claim.ts"]).not.toContain("claimant_principal");
    expect(output["typescript/index.ts"]).toContain('export * from "./failure-claim.js"');
    expect(output["postgres/002_schema.sql"]).not.toContain("runtime_profile");
    expect(Object.keys(output).some((path) => path.includes("upgrade_0_"))).toBe(false);
    for (const publicArtifact of ["operations.json", "capabilities.json", "ui.json", "openapi.json", "events.json"]) {
      expect(output[publicArtifact]).not.toContain("publication_failure_count");
      expect(output[publicArtifact]).not.toContain("lastPublicationErrorCode");
      expect(output[publicArtifact]).not.toContain("publicationDisposition");
      expect(output[publicArtifact]).not.toContain("publicationTotalFailureCount");
      expect(output[publicArtifact]).not.toContain("publicationRecoveryAudit");
      expect(output[publicArtifact]).not.toContain("reasonCode");
      expect(output[publicArtifact]).not.toContain("ML_BROKER_UNAVAILABLE");
      expect(output[publicArtifact]).not.toContain("failureObservation");
      expect(output[publicArtifact]).not.toContain("eventInstanceId");
      expect(output[publicArtifact]).not.toContain("acknowledged");
      expect(output[publicArtifact]).not.toContain("failure_acknowledgement");
      expect(output[publicArtifact]).not.toContain("failureAcknowledgement");
      expect(output[publicArtifact]).not.toContain("acknowledgementAudit");
      expect(output[publicArtifact]).not.toContain("failureClaim");
      expect(output[publicArtifact]).not.toContain("failure_claim");
      expect(output[publicArtifact]).not.toContain("claimantPrincipal");
      expect(output[publicArtifact]).not.toContain("claimed");
      expect(output[publicArtifact]).not.toContain("databasePrincipal");
      expect(output[publicArtifact]).not.toContain("decisionEvidence");
      expect(output[publicArtifact]).not.toContain("storedResponse");
      expect(output[publicArtifact]).not.toContain("privateCursor");
    }
    for (const publicOrAgentArtifact of [
      "typescript/browser.ts", "typescript/http-client.ts", "typescript/ui.ts", "typescript/capabilities.ts",
    ]) {
      expect(output[publicOrAgentArtifact]).not.toContain("failureAcknowledgement");
      expect(output[publicOrAgentArtifact]).not.toContain("acknowledged");
      expect(output[publicOrAgentArtifact]).not.toContain("eventInstanceId");
      expect(output[publicOrAgentArtifact]).not.toContain("reasonCode");
      expect(output[publicOrAgentArtifact]).not.toContain("databasePrincipal");
      expect(output[publicOrAgentArtifact]).not.toContain("acknowledgementAudit");
      expect(output[publicOrAgentArtifact]).not.toContain("failureClaim");
      expect(output[publicOrAgentArtifact]).not.toContain("claimantPrincipal");
      expect(output[publicOrAgentArtifact]).not.toContain("claimed");
      expect(output[publicOrAgentArtifact]).not.toContain("decisionEvidence");
      expect(output[publicOrAgentArtifact]).not.toContain("storedResponse");
      expect(output[publicOrAgentArtifact]).not.toContain("privateCursor");
    }
    expect(output["model.mmd"]).toContain("emits atomically");
  });

  it("generates private transactional inbox consumers without widening public discovery", async () => {
    const output = generateAll(await procurement());
    const semantic = JSON.parse(output["semantic.json"]!) as { consumers: { name: string; emittedEventIds: string[]; failurePolicy: object }[] };
    expect(semantic.consumers).toEqual([expect.objectContaining({
      name: "observeRequestApproval",
      emittedEventIds: ["event:evt_50d694c9a0a274dc79c6168e47d25968"],
      failurePolicy: { mode: "deadLetterAfterMaxAttempts", maxAttempts: 3, recovery: "manual" },
    })]);
    for (const publicArtifact of ["operations.json", "capabilities.json", "ui.json", "openapi.json"]) {
      expect(output[publicArtifact]).not.toContain("observeRequestApproval");
      expect(output[publicArtifact]).not.toContain("event_inbox");
      expect(output[publicArtifact]).not.toContain("consumer_recovery");
      expect(output[publicArtifact]).not.toContain("recoveryGeneration");
    }
    expect(output["postgres/001_roles.sql"]).toContain("modellang_consumer NOLOGIN");
    expect(output["postgres/001_roles.sql"]).toContain("modellang_recovery NOLOGIN");
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."event_inbox"');
    expect(output["postgres/002_schema.sql"]).toContain('CREATE TABLE IF NOT EXISTS "model_procurement_internal"."consumer_audit"');
    expect(output["postgres/003_consumers.sql"]).toContain('ON CONFLICT ("consumer_id", "source_event_id") DO NOTHING');
    expect(output["postgres/003_consumers.sql"]).toContain("p_envelope - 'deliveryAttempt'");
    expect(output["postgres/003_consumers.sql"]).not.toContain("p_envelope := p_envelope ||");
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
    expect(output["typescript/consumers.ts"]).toContain("recoverObserveRequestApproval");
    expect(output["typescript/consumers.ts"]).toContain('status: "retry" | "deadLetter"');
    expect(output["typescript/consumers.ts"]).toContain("record_consumer_failure");
    expect(output["postgres/002_schema.sql"]).toContain('"disposition" text NOT NULL DEFAULT \'retry\'');
    expect(output["postgres/002_schema.sql"]).toContain('"consumer_failure_state"');
    expect(output["postgres/002_schema.sql"]).toContain('"consumer_recovery_audit"');
    expect(output["postgres/002_schema.sql"]).toContain('"recover_consumer_failure"');
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
