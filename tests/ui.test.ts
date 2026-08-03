import { describe, expect, it, vi } from "vitest";
import { ProcurementHttpClient } from "../generated/procurement/typescript/http-client.js";
import { ValidationError } from "../generated/procurement/typescript/errors.js";
import {
  availableProcurementUiTransitions,
  createProcurementUiExecutor,
  createProcurementUiWorkflowExecutor,
  ProcurementUiManifest,
} from "../generated/procurement/typescript/ui.js";
import { ReservationsUiManifest } from "../generated/reservations/typescript/ui.js";

const purchaseRequest = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: "2026-07-31T12:00:00Z",
  requester: "00000000-0000-4000-8000-000000000001",
  amount: { currency: "USD" as const, amount: "10.00" },
  status: "DRAFT" as const,
  approvedBy: null,
  approvedByRoles: null,
  approvalObserved: false,
};

describe("generated UI boundary", () => {
  it("emits a compilable empty workflow boundary for models without workflows", () => {
    expect(ReservationsUiManifest.workflows).toEqual([]);
  });

  it("marks authored query filters as optional and nullable", () => {
    const query = ReservationsUiManifest.queries.find((candidate) => candidate.name === "reservationsForResource")!;
    expect(query.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "resource", required: true, nullable: false }),
      expect.objectContaining({ name: "startsAtOrAfter", required: false, nullable: true }),
    ]));
  });

  it("publishes only closed authored query sort profiles", () => {
    const query = ReservationsUiManifest.queries.find((candidate) => candidate.name === "reservationsForResource")!;
    expect(query.sorting).toMatchObject({
      input: "sort",
      defaultProfile: "default",
      profiles: [
        expect.objectContaining({ name: "default", direction: "asc" }),
        expect.objectContaining({ name: "latestFirst", direction: "desc" }),
        expect.objectContaining({ name: "endingSoonest", direction: "asc" }),
      ],
    });
  });

  it("describes conditional field disclosure without treating it as operation visibility", () => {
    const projection = ProcurementUiManifest.projections.find((candidate) => candidate.name === "RequestSummary")!;
    expect(projection.fields).toContainEqual(expect.objectContaining({
      name: "amount",
      nullable: true,
      redactable: true,
    }));
    const query = ProcurementUiManifest.queries.find((candidate) => candidate.name === "myRequests")!;
    expect(query.disclosure).toMatchObject({
      redaction: "null",
      default: "redacted",
      fields: [expect.objectContaining({
        projectionFieldPath: ["projectionField:pfd_73d694c9a0a274dc79c6168e47d25968"],
        ruleId: expect.stringMatching(/^disclose:query:/),
      })],
    });
    expect(query.readEvidence).toMatchObject({
      mode: "transactionalAudit",
      scope: "successfulCommittedExecution",
      storage: "private",
      payloadRetention: "none",
      revision: expect.stringMatching(/^sha256:/),
    });
  });

  it("executes a descriptor's stable operation ID through the browser HTTP client", async () => {
    const fetch = vi.fn(async () => Response.json(purchaseRequest));
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch,
    });
    const executor = createProcurementUiExecutor(client);
    const descriptor = ProcurementUiManifest.actions.find((action) => action.name === "openRequest")!;

    const result = await executor.execute(descriptor.operationId, {
      amount: { currency: "USD", amount: "10.00" },
    });

    expect(result).toEqual(purchaseRequest);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/operations/actions/act_1e35db0451b1461e941af6283d86dca2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ amount: { currency: "USD", amount: "10.00" } }),
      }),
    );
  });

  it("assesses action applicability separately from execution", async () => {
    const decision = {
      operationId: "action:act_1e35db0451b1461e941af6283d86dca2",
      status: "applicable",
      applicable: true,
      authority: "none",
      revision: "rev:1:0123456789abcdef0123456789abcdef",
    } as const;
    const fetch = vi.fn(async () => Response.json(decision));
    const client = new ProcurementHttpClient({ baseUrl: "https://example.test", accessToken: () => "valid", fetch });
    const executor = createProcurementUiExecutor(client);
    const result = await executor.assess(decision.operationId, { amount: { currency: "USD", amount: "10.00" } });
    expect(result).toEqual(decision);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/operations/actions/act_1e35db0451b1461e941af6283d86dca2/applicability",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed for operation IDs absent from the generated manifest", async () => {
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: async () => Response.json(purchaseRequest),
    });
    const executor = createProcurementUiExecutor(client) as unknown as {
      execute(operationId: string, input: unknown): Promise<unknown>;
    };
    await expect(executor.execute("action:unknown", {})).rejects.toMatchObject({
      name: ValidationError.name,
      code: "ML_UI_OPERATION_NOT_FOUND",
      ruleId: "ui:operation",
    });
  });

  it("never exposes authenticated caller identity as a form or filter input", () => {
    expect(ProcurementUiManifest.authentication).toEqual({ required: true, callerInput: false });
    const inputNames: string[] = [];
    for (const action of ProcurementUiManifest.actions) {
      for (const field of action.fields) inputNames.push(field.name);
    }
    for (const query of ProcurementUiManifest.queries as readonly { filters: readonly { name: string }[] }[]) {
      for (const filter of query.filters) inputNames.push(filter.name);
    }
    expect(inputNames).not.toContain("actor");
  });

  it("finds only structurally available workflow edges and binds their entity target", async () => {
    const fetch = vi.fn(async () => Response.json({ ...purchaseRequest, status: "SUBMITTED" }));
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch,
    });
    const workflow = ProcurementUiManifest.workflows[0]!;
    const transitions = availableProcurementUiTransitions(workflow.workflowId, "DRAFT");
    expect(transitions.map((transition) => transition.name)).toEqual(["submit"]);
    expect(availableProcurementUiTransitions(workflow.workflowId, "APPROVED")).toEqual([]);

    const executor = createProcurementUiWorkflowExecutor(client);
    const result = await executor.executeTransition(transitions[0]!.transitionId, purchaseRequest.id, {});
    expect(result.status).toBe("SUBMITTED");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/operations/actions/act_ed2374e822704c51a2925338253d05d2",
      expect.objectContaining({ body: JSON.stringify({ request: purchaseRequest.id }) }),
    );
  });

  it("fails closed for unknown workflow and transition IDs", async () => {
    expect(() => availableProcurementUiTransitions(
      "workflow:unknown" as typeof ProcurementUiManifest.workflows[0]["workflowId"],
      "DRAFT",
    )).toThrow(ValidationError);
    const client = new ProcurementHttpClient({
      baseUrl: "https://example.test",
      accessToken: () => "valid",
      fetch: async () => Response.json(purchaseRequest),
    });
    const executor = createProcurementUiWorkflowExecutor(client) as unknown as {
      executeTransition(transitionId: string, targetId: string, input: unknown): Promise<unknown>;
    };
    await expect(executor.executeTransition("transition:unknown", purchaseRequest.id, {})).rejects.toMatchObject({
      code: "ML_UI_TRANSITION_NOT_FOUND",
      ruleId: "ui:transition",
    });
  });
});
