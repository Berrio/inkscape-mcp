import { expect, it } from "vitest";

import {
  beginExportExecution,
  buildExportArgv,
  createExportManifest,
  exportSpecSchema,
  normalizeExportArea,
  parseExportSpec,
  runExportPipeline,
} from "../../src/export/index.js";

const revision = "a".repeat(64);
const source = { expectedRevision: revision, path: "labels.svg" };
const target = {
  kind: "file" as const,
  overwrite: false,
  path: "out/label.png",
};

it("accepts a PNG-only custom area and produces fixed export argv", () => {
  const spec = parseExportSpec({
    area: { kind: "custom", rect: { height: 20, width: 10, x: -2, y: 3 } },
    background: { color: "#ff0000", mode: "solid", opacity: 0.5 },
    format: "png",
    size: { mode: "exact", allowDistortion: true, widthPx: 300, heightPx: 200 },
    source,
    target,
  });
  const area = normalizeExportArea(spec.area, []);
  expect(area.args).toEqual(["--export-area=-2:3:8:23"]);
  expect(
    buildExportArgv({
      area,
      inputPath: "trusted-input.svg",
      outputPath: "trusted-output.png",
      spec,
    }),
  ).toEqual([
    "--export-type=png",
    "trusted-input.svg",
    "--export-filename=trusted-output.png",
    "--export-area=-2:3:8:23",
    "--export-width=300",
    "--export-height=200",
    "--export-background=#ff0000",
    "--export-background-opacity=0.5",
  ]);
});

it("rejects crossed format, target, path and overwrite combinations", () => {
  expect(
    exportSpecSchema.safeParse({
      area: { kind: "custom", rect: { height: 1, width: 1, x: 0, y: 0 } },
      filters: "preserve",
      format: "pdf",
      source,
      target: { kind: "file", overwrite: false, path: "out.pdf" },
      text: "preserve",
    }).success,
  ).toBe(false);
  expect(
    exportSpecSchema.safeParse({
      area: {
        elementIds: ["one", "two"],
        kind: "selection",
        output: "each",
        visibility: "selected-only",
      },
      background: { mode: "transparent" },
      format: "png",
      source,
      target,
    }).success,
  ).toBe(false);
  expect(
    exportSpecSchema.safeParse({
      area: { kind: "drawing" },
      background: { mode: "document" },
      format: "png",
      source: { ...source, path: "../labels.svg" },
      target,
    }).success,
  ).toBe(false);
  expect(
    exportSpecSchema.safeParse({
      area: { kind: "drawing" },
      background: { mode: "document" },
      format: "png",
      source,
      target: { kind: "file", overwrite: true, path: "out/label.png" },
    }).success,
  ).toBe(false);
});

it("requires a directory target for planned PNG variants", () => {
  const result = exportSpecSchema.safeParse({
    area: { kind: "page", pageIds: ["page_a", "page_b"] },
    background: { mode: "transparent" },
    format: "png",
    source,
    target: {
      directory: "out",
      kind: "directory",
      strategy: "directory_rename",
      template: "{page}.{format}",
    },
  });
  expect(result.success).toBe(true);
});

it("makes cancellation and progress ordering explicit", () => {
  const stages: string[] = [];
  const execution = beginExportExecution({
    onProgress: ({ stage }) => stages.push(stage),
  });
  execution.checkpoint("validated");
  execution.checkpoint("rendering");
  expect(() => execution.checkpoint("staging")).toThrow(
    "cannot move backwards",
  );
  expect(stages).toEqual(["validated", "rendering"]);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    beginExportExecution({ signal: controller.signal }).checkpoint("validated"),
  ).toThrow("aborted");
});

it("records a redacted normalized request in a common export manifest", () => {
  const spec = parseExportSpec({
    area: { kind: "drawing" },
    background: { mode: "transparent" },
    format: "png",
    source,
    target,
  });
  const manifest = createExportManifest({
    artifacts: [
      {
        hash: "b".repeat(64),
        id: "art_" + "c".repeat(32),
        size: 10,
        uri: "inkscape://artifact/art_" + "c".repeat(32),
      },
    ],
    durationMs: 4,
    inkscapeVersion: "1.4.4",
    normalizedRequest: spec,
    strategy: "single_file",
    warnings: ["FONT_SUBSTITUTION_POSSIBLE"],
  });
  expect(manifest.normalizedRequest.source.path).toBe("labels.svg");
  expect(JSON.stringify(manifest)).not.toContain(":\\");
});

it("runs render, verification and publication through one cleanup-safe pipeline", async () => {
  const stages: string[] = [];
  const result = await runExportPipeline(
    {
      cleanup: async (staged) => stages.push(`cleanup:${staged}`),
      publish: async (verified) => `${verified}:published`,
      render: async (staged) => `${staged}:rendered`,
      stage: async () => "staged",
      validate: () => undefined,
      verify: async (rendered) => `${rendered}:verified`,
    },
    { onProgress: ({ stage }) => stages.push(stage) },
  );
  expect(result).toBe("staged:rendered:verified:published");
  expect(stages).toEqual([
    "validated",
    "staging",
    "rendering",
    "verifying",
    "publishing",
    "completed",
    "cleanup:staged",
  ]);
});
