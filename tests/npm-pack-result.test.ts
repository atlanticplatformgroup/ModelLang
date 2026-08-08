import { describe, expect, it } from "vitest";
import { parsePackResult } from "../scripts/npm-pack-result.js";

const packageMetadata = {
  filename: "modellang-0.50.0.tgz",
  name: "modellang",
  version: "0.50.0",
  files: [{ path: "package.json" }],
};

describe("npm pack result parsing", () => {
  it("accepts the npm 10 array format", () => {
    expect(parsePackResult(JSON.stringify([packageMetadata]))).toEqual(packageMetadata);
  });

  it("accepts the npm 12 package-keyed object format", () => {
    expect(parsePackResult(JSON.stringify({ modellang: packageMetadata }))).toEqual(packageMetadata);
  });

  it("rejects malformed or multi-package output", () => {
    expect(() => parsePackResult("{}"))
      .toThrow("npm pack did not return exactly one valid package");
    expect(() => parsePackResult(JSON.stringify([packageMetadata, packageMetadata])))
      .toThrow("npm pack did not return exactly one valid package");
  });
});
