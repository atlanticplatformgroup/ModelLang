import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";

export type StableIdKind =
  | "entity"
  | "field"
  | "projection"
  | "projectionField"
  | "enum"
  | "enumMember"
  | "event"
  | "policy"
  | "policyBranch"
  | "action"
  | "consumer"
  | "query"
  | "invariant"
  | "exclusion"
  | "workflow"
  | "transition"
  | "extension";

export interface AssignedStableIds {
  source: string;
  assigned: number;
}

function generatedId(kind: StableIdKind): string {
  const prefix: Record<StableIdKind, string> = {
    entity: "ent",
    field: "fld",
    projection: "prj",
    projectionField: "pfd",
    enum: "enm",
    enumMember: "emv",
    event: "evt",
    policy: "pol",
    policyBranch: "pbr",
    action: "act",
    consumer: "con",
    query: "qry",
    invariant: "inv",
    exclusion: "exc",
    workflow: "wfl",
    transition: "trn",
    extension: "ext",
  };
  return `${prefix[kind]}_${randomUUID().replaceAll("-", "")}`;
}

export function assignStableIds(
  source: string,
  file = "<source>",
  createId: (kind: StableIdKind) => string = generatedId,
): AssignedStableIds {
  const program = parse(source, file);
  const edits: { offset: number; text: string }[] = [];
  for (const declaration of program.declarations) {
    if ("stableId" in declaration && !declaration.stableId) {
      edits.push({
        offset: declaration.nameSpan.end.offset,
        text: ` @stableId("${createId(declaration.kind)}")`,
      });
    }
    if (declaration.kind === "enum") {
      for (const member of declaration.members) {
        if (member.stableId) continue;
        edits.push({
          offset: member.nameSpan.end.offset,
          text: ` @stableId("${createId("enumMember")}")`,
        });
      }
    }
    if (declaration.kind === "entity") {
      for (const member of declaration.members) {
        if (member.kind === "field") {
          if (member.annotations.some((annotation) => annotation.name === "stableId")) continue;
          edits.push({
            offset: member.span.end.offset - 1,
            text: ` @stableId("${createId("field")}")`,
          });
        } else if (!member.stableId) {
          edits.push({
            offset: member.nameSpan.end.offset,
            text: ` @stableId("${createId(member.kind)}")`,
          });
        }
      }
    }
    if (declaration.kind === "projection") {
      for (const field of declaration.fields) {
        if (field.stableId) continue;
        edits.push({
          // Scalar projection fields take the annotation after the field name,
          // while nested fields take it after the projection type:
          //   id @stableId("pfd_...");
          //   owner: UserSummary @stableId("pfd_...");
          offset: field.nestedProjectionType?.span.end.offset ?? field.nameSpan.end.offset,
          text: ` @stableId("${createId("projectionField")}")`,
        });
      }
    }
    if (declaration.kind === "workflow") {
      for (const transition of declaration.transitions) {
        if (transition.stableId) continue;
        edits.push({
          offset: transition.nameSpan.end.offset,
          text: ` @stableId("${createId("transition")}")`,
        });
      }
    }
    if (declaration.kind === "policy") {
      for (const branch of declaration.branches) {
        if (branch.stableId) continue;
        edits.push({
          offset: branch.nameSpan.end.offset,
          text: ` @stableId("${createId("policyBranch")}")`,
        });
      }
    }
  }
  let result = source;
  for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
    result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
  }
  try {
    parse(result, file);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`assign-ids generated invalid ModelLang source; the source file was not written (${detail})`, { cause: error });
  }
  return { source: result, assigned: edits.length };
}
