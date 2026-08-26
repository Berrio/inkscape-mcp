import { describe, expect, it } from "vitest";

import { parseExportSpec, planExportBatch } from "../../src/export/index.js";

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
});
