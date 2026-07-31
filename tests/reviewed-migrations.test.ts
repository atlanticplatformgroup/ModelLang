import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileText } from "../src/compiler.js";
import { ModelError } from "../src/diagnostics.js";
import {
  parseReviewedMigrationPlan,
  planReviewedMigration,
  REVIEWED_MIGRATION_SCHEMA,
  reviewedMigrationPlanHash,
  type ReviewedMigrationPlanDocument,
} from "../src/reviewed-migrations.js";
import { semanticDiff } from "../src/semantic-diff.js";

const ids = {
  status: "enm_16161616161616161616161616161616",
  draft: "emv_16161616161616161616161616161616",
  old: "emv_17171717171717171717171717171717",
  active: "emv_18181818181818181818181818181818",
  user: "ent_16161616161616161616161616161616",
  userId: "fld_16161616161616161616161616161616",
  ticket: "ent_17171717171717171717171717171717",
  ticketId: "fld_17171717171717171717171717171717",
  statusField: "fld_18181818181818181818181818181818",
  legacy: "fld_19191919191919191919191919191919",
  category: "fld_20202020202020202020202020202020",
  invariant: "inv_16161616161616161616161616161616",
  open: "act_16161616161616161616161616161616",
};

function source(version: string, current: boolean): string {
  return `model ReviewedEvolution version "${version}";
enum Status @stableId("${ids.status}") {
  DRAFT @stableId("${ids.draft}"),
  ${current ? `ACTIVE @stableId("${ids.active}")` : `OLD @stableId("${ids.old}")`}
}
entity User @stableId("${ids.user}") {
  id: UUID @id @stableId("${ids.userId}");
}
entity Ticket @stableId("${ids.ticket}") {
  id: UUID @id @stableId("${ids.ticketId}");
  status: Status = Status.${current ? "ACTIVE" : "OLD"} @stableId("${ids.statusField}");
  ${current
    ? `category: String @stableId("${ids.category}");
  invariant category_present @stableId("${ids.invariant}"): category != "";`
    : `legacy: String @stableId("${ids.legacy}");`}
}
action open @stableId("${ids.open}")(caller actor: User, id: UUID) -> Ticket {
  authorize true;
  create Ticket { id = id; status = Status.${current ? "ACTIVE" : "OLD"}; ${current ? `category = "GENERAL";` : `legacy = "legacy";`} }
}`;
}

function document(previous: ReturnType<typeof compileText>, current: ReturnType<typeof compileText>): ReviewedMigrationPlanDocument {
  const changes = semanticDiff(previous, current).changes.filter((change) => change.classification !== "additive");
  return {
    $schema: REVIEWED_MIGRATION_SCHEMA,
    planVersion: 1,
    strategy: "transactionalRebuild",
    description: "Replace legacy classification with reviewed category and active status.",
    from: { modelId: previous.model.id, version: previous.model.version, sourceHash: previous.model.sourceHash },
    to: { modelId: current.model.id, version: current.model.version, sourceHash: current.model.sourceHash },
    acknowledgements: changes.map((change) => ({
      changeKind: change.kind,
      subjectId: change.subject.id,
      disposition: change.kind === "declarationRemoved"
        ? change.subject.id === `enumMember:${ids.old}` ? "transformed" : "dataLossAccepted"
        : "accepted",
      reason: "Reviewed against stored Procurement data and the new contract.",
    })),
    fieldValues: [{ targetFieldId: `field:${ids.category}`, source: { kind: "literal", value: "GENERAL" } }],
    enumMappings: [{
      enumId: `enum:${ids.status}`,
      members: [{ fromMemberId: `enumMember:${ids.old}`, toMemberId: `enumMember:${ids.active}` }],
    }],
  };
}

function modelError(operation: () => unknown): ModelError {
  try { operation(); } catch (caught) {
    expect(caught).toBeInstanceOf(ModelError);
    return caught as ModelError;
  }
  throw new Error("Expected ModelError");
}

describe("reviewed semantic migrations", () => {
  it("validates the public plan schema and hashes semantic JSON canonically", async () => {
    const previous = compileText(source("1.0.0", false), "previous.model");
    const current = compileText(source("2.0.0", true), "current.model");
    const plan = document(previous, current);
    const schema = JSON.parse(await readFile("schemas/reviewed-migration-plan.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(plan), JSON.stringify(validate.errors)).toBe(true);
    expect(parseReviewedMigrationPlan(plan)).toEqual(plan);
    const reordered = {
      enumMappings: plan.enumMappings,
      fieldValues: plan.fieldValues,
      acknowledgements: plan.acknowledgements,
      to: plan.to,
      from: plan.from,
      description: plan.description,
      strategy: plan.strategy,
      planVersion: plan.planVersion,
      $schema: plan.$schema,
    };
    expect(parseReviewedMigrationPlan(reordered)).toEqual(plan);
    expect(reviewedMigrationPlanHash(plan)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reviewedMigrationPlanHash(reordered)).toBe(reviewedMigrationPlanHash(plan));
    expect(reviewedMigrationPlanHash({
      ...plan,
      acknowledgements: [...plan.acknowledgements].reverse(),
      fieldValues: [...plan.fieldValues].reverse(),
      enumMappings: [...plan.enumMappings].reverse(),
    })).toBe(reviewedMigrationPlanHash(plan));
  });

  it("covers every review-required semantic change and emits a deterministic staging migration", () => {
    const previous = compileText(source("1.0.0", false), "previous.model");
    const current = compileText(source("2.0.0", true), "current.model");
    const plan = document(previous, current);
    const first = planReviewedMigration(previous, current, plan);
    const second = planReviewedMigration(previous, current, JSON.parse(JSON.stringify(plan)));
    expect(second.planHash).toBe(first.planHash);
    expect(second.sql).toBe(first.sql);
    expect(first.sql).toContain(`-- plan ${first.planHash}`);
    expect(first.sql).toContain("IN ACCESS EXCLUSIVE MODE");
    expect(first.sql).toContain("CASE source.\"status\"");
    expect(first.sql).toContain("'GENERAL'::text");
    expect(first.sql).toContain("ML_MIGRATION_ROW_COUNT");
    expect(first.sql).toContain("'reviewed'");
    expect(first.sql).toContain('DROP SCHEMA "model_reviewed_evolution";');
    expect(first.sql).not.toContain('DROP SCHEMA "model_reviewed_evolution" CASCADE');
    expect(Object.keys(plan)).not.toContain("sql");
  });

  it("fails closed on missing review, stale hashes, and unsupported type transformations", () => {
    const previous = compileText(source("1.0.0", false), "previous.model");
    const current = compileText(source("2.0.0", true), "current.model");
    const missing = document(previous, current);
    missing.acknowledgements.pop();
    expect(modelError(() => planReviewedMigration(previous, current, missing)).code).toBe("E2904");

    const stale = document(previous, current);
    stale.from.sourceHash = `sha256:${"0".repeat(64)}`;
    expect(modelError(() => planReviewedMigration(previous, current, stale)).code).toBe("E2902");

    const unmapped = document(previous, current);
    unmapped.enumMappings = [];
    expect(modelError(() => planReviewedMigration(previous, current, unmapped)).code).toBe("E2918");

    const changedType = compileText(source("2.0.0", true).replace(
      `status: Status = Status.ACTIVE @stableId("${ids.statusField}");`,
      `status: String = "ACTIVE" @stableId("${ids.statusField}");`,
    ).replace("status = Status.ACTIVE;", `status = "ACTIVE";`), "changed-type.model");
    const changedPlan = document(previous, changedType);
    expect(modelError(() => planReviewedMigration(previous, changedType, changedPlan)).code).toBe("E2911");
  });
});
