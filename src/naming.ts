export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function pascalCase(value: string): string {
  return value.replace(/(^|_)([a-z])/g, (_, _prefix: string, letter: string) => letter.toUpperCase());
}
