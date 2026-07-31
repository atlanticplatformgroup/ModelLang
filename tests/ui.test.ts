import { describe, expect, it, vi } from "vitest";
import { ProcurementHttpClient } from "../generated/procurement/typescript/http-client.js";
import { ValidationError } from "../generated/procurement/typescript/errors.js";
import {
  createProcurementUiExecutor,
  ProcurementUiManifest,
} from "../generated/procurement/typescript/ui.js";

const purchaseRequest = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: "2026-07-31T12:00:00Z",
  requester: "00000000-0000-4000-8000-000000000001",
  amount: { currency: "USD" as const, amount: "10.00" },
  status: "DRAFT" as const,
  approvedBy: null,
  approvedByRoles: null,
};

describe("generated UI boundary", () => {
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
});
