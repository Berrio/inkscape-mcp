import { expect, it } from "vitest";

import { createExportBatchManifest } from "../../src/export/index.js";

it("creates a portable batch manifest without retaining mutable input", () => {
  const source = { expectedRevision: "a".repeat(64), path: "labels.svg" };
  const variants = [
    {
      format: "png" as const,
      index: 0,
      outputPath: "out/label.png",
      revision: "b".repeat(64),
    },
  ];
  const manifest = createExportBatchManifest({
    durationMs: 123,
    failures: [],
    inkscapeVersion: "1.4.4",
    mode: "all_or_nothing",
    publication: "file_commit_batch",
    source,
    variants,
  });
  source.path = "changed.svg";
  variants[0]!.outputPath = "changed.png";
  expect(manifest).toMatchObject({
    inkscapeVersion: "1.4.4",
    publication: "file_commit_batch",
    source: { path: "labels.svg" },
    variants: [{ outputPath: "out/label.png" }],
  });
  expect(JSON.stringify(manifest)).not.toContain(":\\");
});
