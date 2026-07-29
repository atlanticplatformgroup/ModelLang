export interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface Span {
  start: Position;
  end: Position;
}

export class ModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly span: Span,
    readonly file = "<source>",
    readonly related?: { message: string; span: Span },
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export function formatDiagnostic(error: ModelError, source?: string): string {
  const at = `${error.file}:${error.span.start.line}:${error.span.start.column}`;
  let result = `${error.code} ${at}\n${error.message}`;
  if (source) {
    const line = source.split(/\r?\n/)[error.span.start.line - 1] ?? "";
    const width = Math.max(1, error.span.end.offset - error.span.start.offset);
    result += `\n  ${line}\n  ${" ".repeat(error.span.start.column - 1)}${"^".repeat(Math.min(width, Math.max(1, line.length)))}`;
  }
  if (error.related) {
    result += `\nRelated: ${error.related.message} at ${error.related.span.start.line}:${error.related.span.start.column}`;
  }
  return result;
}

export function internalSpan(): Span {
  const p = { offset: 0, line: 1, column: 1 };
  return { start: p, end: p };
}
