import { describe, expect, it } from "vitest";

import { ExportPlanStore } from "../../src/server/export-plans.js";

const spec = {
  area: { kind: "drawing" as const },
  background: { mode: "transparent" as const },
  format: "png" as const,
  size: { mode: "width" as const, widthPx: 100 },
  source: { expectedRevision: "a".repeat(64), path: "source.svg" },
  target: { kind: "file" as const, overwrite: false as const, path: "out.png" },
};

describe("export preset plans", () => {
  it("binds a one-use plan to its owner", () => {
    const store = new ExportPlanStore();
    const plan = store.create("ws_1234567890abcdef", {
      digest: "b".repeat(64),
      outputDirectory: "deliverables",
      specs: [spec],
      ttlMs: 1_000,
    });
    expect(plan.outputPaths).toEqual(["out.png"]);
    expect(store.consume(plan.token, "ws_1234567890abcdef").digest).toBe(
      "b".repeat(64),
    );
    expect(() => store.consume(plan.token, "ws_1234567890abcdef")).toThrow(
      "unavailable",
    );
  });

  it("does not expose an owner plan to another workspace", () => {
    const store = new ExportPlanStore();
    const plan = store.create("ws_1234567890abcdef", {
      digest: "b".repeat(64),
      outputDirectory: "deliverables",
      specs: [spec],
      ttlMs: 1_000,
    });
    expect(() => store.consume(plan.token, "ws_fedcba0987654321")).toThrow(
      "unavailable",
    );
  });
});
