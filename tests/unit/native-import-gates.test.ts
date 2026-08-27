import { describe, expect, it } from "vitest";

import { inspectNativeImportGates } from "../../src/import/native-import-gates.js";

describe("native import capability gates", () => {
  it("keeps advertised extension formats blocked until headless validation", () => {
    expect(inspectNativeImportGates(["ai", "ai.svg", "pdf", "xaml"])).toEqual([
      {
        advertisedTypes: ["ai", "ai.svg"],
        format: "ai",
        headless: "not-validated",
        status: "detected-but-blocked",
      },
      {
        advertisedTypes: [],
        format: "eps",
        headless: "not-validated",
        status: "not-detected",
      },
      {
        advertisedTypes: [],
        format: "ps",
        headless: "not-validated",
        status: "not-detected",
      },
      {
        advertisedTypes: [],
        format: "emf",
        headless: "not-validated",
        status: "not-detected",
      },
      {
        advertisedTypes: [],
        format: "wmf",
        headless: "not-validated",
        status: "not-detected",
      },
      {
        advertisedTypes: ["xaml"],
        format: "xaml",
        headless: "not-validated",
        status: "detected-but-blocked",
      },
      {
        advertisedTypes: [],
        format: "dxf",
        headless: "not-validated",
        status: "not-detected",
      },
    ]);
  });
});
