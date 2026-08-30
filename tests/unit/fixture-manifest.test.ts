import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("fixture manifest bootstrap", () => {
  it("ships a parseable manifest and JSON Schema", () => {
    const manifest = readJson(
      resolve(root, "tests", "fixtures", "manifest.json"),
    ) as {
      $schema: string;
      fixtures: unknown[];
      schemaVersion: number;
    };
    const schema = readJson(
      resolve(root, "schemas", "fixture-manifest.schema.json"),
    ) as {
      $schema: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtures).toEqual([
      expect.objectContaining({
        applicability: expect.objectContaining({
          capabilities: ["input:eps"],
          inkscape: "1.4.4",
        }),
        id: "minimal-eps",
        license: { spdx: "MIT" },
        source: { file: "minimal.eps", origin: "first-party" },
      }),
    ]);
    expect(manifest.$schema).toContain("fixture-manifest.schema.json");
    expect(schema.$schema).toContain("draft/2020-12/schema");
    expect(schema.required).toEqual(["schemaVersion", "fixtures"]);
    expect(schema.properties).toHaveProperty("fixtures");
  });
});
