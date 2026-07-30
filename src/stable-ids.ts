import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";

export type StableIdKind = "entity" | "field";

export interface AssignedStableIds {
  source: string;
  assigned: number;
}

function generatedId(kind: StableIdKind): string {
  return `${kind === "entity" ? "ent" : "fld"}_${randomUUID().replaceAll("-", "")}`;
}

export function assignStableIds(
  source: string,
  file = "<source>",
  createId: (kind: StableIdKind) => string = generatedId,
): AssignedStableIds {
  const program = parse(source, file);
  const edits: { offset: number; text: string }[] = [];
  for (const declaration of program.declarations) {
    if (declaration.kind !== "entity") continue;
    if (!declaration.stableId) {
      edits.push({
        offset: declaration.nameSpan.end.offset,
        text: ` @stableId("${createId("entity")}")`,
      });
    }
    for (const member of declaration.members) {
      if (member.kind !== "field" || member.annotations.some((annotation) => annotation.name === "stableId")) continue;
      edits.push({
        offset: member.span.end.offset - 1,
        text: ` @stableId("${createId("field")}")`,
      });
    }
  }
  let result = source;
  for (const edit of edits.sort((left, right) => right.offset - left.offset)) {
    result = `${result.slice(0, edit.offset)}${edit.text}${result.slice(edit.offset)}`;
  }
  return { source: result, assigned: edits.length };
}
