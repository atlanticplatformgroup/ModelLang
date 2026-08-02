import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { semanticDiff } from "../src/semantic-diff.js";

const ids = {
  user: "ent_11111111111111111111111111111111",
  userId: "fld_11111111111111111111111111111111",
  record: "ent_22222222222222222222222222222222",
  recordId: "fld_22222222222222222222222222222222",
  owner: "fld_33333333333333333333333333333333",
  value: "fld_44444444444444444444444444444444",
  note: "fld_55555555555555555555555555555555",
  create: "act_11111111111111111111111111111111",
  query: "qry_11111111111111111111111111111111",
};

function model(options: { version: string; actionName?: string; authorize?: string; precondition?: string; where?: string; note?: boolean; assignNote?: boolean }): string {
  return `model SemanticChange version "${options.version}";
entity User @stableId("${ids.user}") {
  id: UUID @id @stableId("${ids.userId}");
}
entity Record @stableId("${ids.record}") {
  id: UUID @id @stableId("${ids.recordId}");
  owner: User @stableId("${ids.owner}");
  value: String @stableId("${ids.value}");
  ${options.note ? `note: String? @stableId("${ids.note}");` : ""}
}
action ${options.actionName ?? "createRecord"} @stableId("${ids.create}")(
  caller actor: User,
  id: UUID,
  value: String
) -> Record {
  authorize ${options.authorize ?? "false"};
  ${options.precondition ?? ""}
  create Record { id = id; owner = actor; value = value; ${options.assignNote ? "note = value;" : ""} }
}
query records @stableId("${ids.query}")(
  caller actor: User
) from Record as row {
  authorize true;
  where ${options.where ?? "row.owner == actor"};
  orderBy row.id asc;
  limit 10;
}`;
}

describe("semantic change analysis", () => {
  it("tracks policy identity-preserving renames and reviewed authority changes", () => {
    const source = (version: string, policyName: string, branchName: string, predicate: string) => `model PolicyDiff version "${version}";
enum Role @stableId("enm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  MANAGER @stableId("emv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  role: Role @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
}
entity Record @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @generated(uuid) @stableId("fld_cccccccccccccccccccccccccccccccc");
}
policy ${policyName} @stableId("pol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(actor: User) {
  allow ${branchName} @stableId("pbr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"): ${predicate};
}
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User) -> Record {
  authorize ${policyName}(actor);
  create Record { }
}`;
    const previous = compileText(source("1", "MayApprove", "manager", "actor.role == Role.MANAGER"), "previous.model");
    const current = compileText(source("2", "ApprovalAuthority", "managerAuthority", "true"), "current.model");
    const report = semanticDiff(previous, current);
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "identityPreservingRename", subject: expect.objectContaining({ kind: "policy" }) }),
      expect.objectContaining({ kind: "identityPreservingRename", subject: expect.objectContaining({ kind: "policyBranch" }) }),
      expect.objectContaining({ kind: "policyBranchChanged", classification: "review" }),
    ]));
  });

  it("classifies identity, authority, validation, visibility, and structural changes without claiming migration safety", async () => {
    const previous = compileText(model({ version: "1" }), "previous.model");
    const current = compileText(model({
      version: "2",
      actionName: "openRecord",
      authorize: "true",
      precondition: 'require has_value: value != "";',
      where: "true",
      note: true,
    }), "current.model");
    const report = semanticDiff(previous, current);
    const schema = JSON.parse(await readFile("schemas/semantic-diff.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report).toMatchObject({
      diffVersion: 9,
      compilerVersion: "0.24.0",
      irVersion: 16,
      migrationAuthority: "separateGuardedMigrationPlanners",
    });
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "declarationAdded", area: "structure", classification: "additive" }),
      expect.objectContaining({ kind: "identityPreservingRename", area: "identity", classification: "additive" }),
      expect.objectContaining({ kind: "authorizationChanged", area: "authorization", classification: "expansive" }),
      expect.objectContaining({ kind: "preconditionAdded", area: "validation", classification: "restrictive" }),
      expect.objectContaining({ kind: "rowVisibilityChanged", area: "queryVisibility", classification: "expansive" }),
    ]));
    expect(report.summary).toEqual({ additive: 2, restrictive: 1, expansive: 2, breaking: 0, review: 0 });
  });

  it("reports removal and effect changes for review instead of stopping at the first unsafe change", () => {
    const previous = compileText(model({ version: "1", note: true, assignNote: true }), "previous.model");
    const current = compileText(model({ version: "2" }), "current.model");
    const report = semanticDiff(previous, current);
    expect(report.changes).toContainEqual(expect.objectContaining({
      kind: "declarationRemoved",
      area: "structure",
      classification: "breaking",
      persistenceRisk: true,
    }));
    expect(report.changes).toContainEqual(expect.objectContaining({
      kind: "effectChanged",
      area: "effect",
      classification: "review",
    }));
    expect(report.summary.breaking).toBe(1);
    expect(report.summary.review).toBe(1);
  });

  it("tracks event declarations and action emission changes by stable identity", () => {
    const source = (version: string, emit: boolean) => `model EventDiff version "${version}";
entity User { id: UUID @id; }
entity Record { id: UUID @id @generated(uuid); }
event RecordCreated @stableId("evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") payload Record;
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User) -> Record {
  authorize true;
  create Record { }
  ${emit ? "emit RecordCreated;" : ""}
}`;
    const report = semanticDiff(compileText(source("1", false)), compileText(source("2", true)));
    expect(report.changes).toContainEqual(expect.objectContaining({
      kind: "emittedEventsChanged",
      area: "eventDelivery",
      classification: "review",
    }));
  });

  it("tracks consumer additions and fails review-sensitive handler changes closed", () => {
    const source = (version: string, authorization: string | null, emit = false, retry = "") => `model ConsumerDiff version "${version}";
entity User @stableId("ent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  id: UUID @id @stableId("fld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
}
entity Record @stableId("ent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
  id: UUID @id @stableId("fld_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  observed: Boolean = false @stableId("fld_cccccccccccccccccccccccccccccccc");
}
event RecordCreated @stableId("evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") payload Record;
event RecordObserved @stableId("evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") payload Record;
action make @stableId("act_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")(caller actor: User, id: UUID) -> Record {
  authorize true;
  create Record { id = id; }
  emit RecordCreated;
}
${authorization === null ? "" : `consumer observe @stableId("con_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") on RecordCreated(payload record: Record) -> Record {
  authorize ${authorization};
  ${retry}
  update record { observed = true; }
  ${emit ? "emit RecordObserved;" : ""}
}`}`;
    const without = compileText(source("1", null));
    const added = compileText(source("2", "true"));
    expect(semanticDiff(without, added).changes).toContainEqual(expect.objectContaining({
      kind: "declarationAdded",
      area: "eventConsumption",
      classification: "additive",
      subject: expect.objectContaining({ kind: "consumer" }),
    }));
    expect(semanticDiff(added, compileText(source("3", "false"))).changes).toContainEqual(expect.objectContaining({
      kind: "consumerAuthorizationChanged",
      area: "authorization",
      classification: "restrictive",
    }));
    expect(semanticDiff(added, compileText(source("3", "true", true))).changes).toContainEqual(expect.objectContaining({
      kind: "consumerEmittedEventsChanged",
      area: "eventDelivery",
      classification: "review",
    }));
    expect(semanticDiff(added, compileText(source("3", "true", false, "retry maxAttempts 3;"))).changes).toContainEqual(expect.objectContaining({
      kind: "consumerFailurePolicyChanged",
      area: "executionReliability",
      classification: "review",
    }));
    const bounded = compileText(source("3", "true", false, "retry maxAttempts 3;"));
    const recoverable = compileText(source("4", "true", false, "retry maxAttempts 3; recovery manual;"));
    expect(semanticDiff(bounded, recoverable).changes).toContainEqual(expect.objectContaining({
      kind: "consumerFailurePolicyChanged",
      before: expect.stringContaining('"recovery":"none"'),
      after: expect.stringContaining('"recovery":"manual"'),
      classification: "review",
    }));
  });
});
