export interface PackResult {
  filename: string;
  name: string;
  version: string;
  files: { path: string }[];
}

function isPackResult(value: unknown): value is PackResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PackResult>;
  return typeof candidate.filename === "string"
    && typeof candidate.name === "string"
    && typeof candidate.version === "string"
    && Array.isArray(candidate.files)
    && candidate.files.every((file) => typeof file?.path === "string");
}

export function parsePackResult(stdout: string): PackResult {
  const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, "")) as unknown;
  const results = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : [];
  if (results.length !== 1 || !isPackResult(results[0])) {
    throw new Error("npm pack did not return exactly one valid package");
  }
  return results[0];
}
