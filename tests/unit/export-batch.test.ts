import { describe, expect, it } from "vitest";

import {
  executeExportBatch,
  parseExportSpec,
  planExportBatch,
} from "../../src/export/index.js";

const png = (path: string) =>
  parseExportSpec({
    area: { kind: "drawing" },
    background: { mode: "transparent" },
    format: "png",
    source: {
      expectedRevision: "a".repeat(64),
      path: "source.svg",
    },
    target: { kind: "file", overwrite: false, path },
  });

describe("export batch planning", () => {
  it("orders single-file variants and rejects output collisions", () => {
    expect(planExportBatch([png("one.png"), png("two.png")])).toMatchObject([
      { index: 0, outputPath: "one.png" },
      { index: 1, outputPath: "two.png" },
    ]);
    expect(() => planExportBatch([png("same.png"), png("SAME.png")])).toThrow(
      "collide",
    );
  });
  it("continues best effort but stops all-or-nothing after a failure", async () => {
    const variants = planExportBatch([png("one.png"), png("two.png")]);
    const best = await executeExportBatch({
      execute: async (variant) => {
        if (variant.index === 0) throw new Error("first failed");
        return variant.outputPath;
      },
      mode: "best_effort",
      variants,
    });
    expect(best).toMatchObject({
      failures: [{ index: 0, message: "first failed" }],
      successes: [{ index: 1, value: "two.png" }],
    });
    const atomic = await executeExportBatch({
      execute: async () => {
        throw new Error("stop");
      },
      mode: "all_or_nothing",
      variants,
    });
    expect(atomic).toMatchObject({
      failures: [{ index: 0, message: "stop" }],
      successes: [],
    });
  });
});
