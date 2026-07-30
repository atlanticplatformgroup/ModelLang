import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";

export type StableIdKind =
  | "entity"
  | "field"
  | "enum"
  | "enumMember"
  | "action"
  | "query"
  | "invariant"
  | "exclusion"
  | "workflow"
  | "transition";

export interface AssignedStableIds {
  source: string;
  assigned: number;
}

function generatedId(kind: StableIdKind): string {
  const prefix: Record<StableIdKind, string> = {
    entity: "ent",
    field: "fld",
    enum: "enm",
    enumMember: "emv",
    action: "act",
    query: "qry",
    invariant: "inv",
    exclusion: "exc",
    workflow: "wfl",
    transition: "trn",
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
    if (declaration.kind === "workflow") {
      for (const transition of declaration.transitions) {
        if (transition.stableId) continue;
        edits.push({
          offset: transition.nameSpan.end.offset,
          text: ` @stableId("${createId("transition")}")`,
        });
      }
    }
  }
  let result = source;
  for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
    result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
  }
  return { source: result, assigned: edits.length };
}
