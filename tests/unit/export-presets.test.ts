import { describe, expect, it } from "vitest";

import {
  expandExportPreset,
  exportPresetSchema,
  planExportBatch,
} from "../../src/export/index.js";

const source = {
  expectedRevision: "a".repeat(64),
  path: "source.svg",
};

describe("export presets", () => {
  it("expands every public preset into collision-free ordinary specs", () => {
    for (const name of [
      "print-a4-pdf",
      "web-png",
      "plain-svg",
      "icon-pack",
    ] as const) {
      const preset = exportPresetSchema.parse({
        name,
        outputDirectory: "deliverables",
        source,
      });
      const specs = expandExportPreset(preset);
      expect(specs.length).toBe(name === "icon-pack" ? 8 : 1);
      expect(planExportBatch(specs)).toHaveLength(specs.length);
      expect(specs.every((spec) => spec.source.path === source.path)).toBe(
        true,
      );
      expect(
        specs.every(
          (spec) => spec.source.expectedRevision === source.expectedRevision,
        ),
      ).toBe(true);
      expect(specs.every((spec) => spec.target.kind === "file")).toBe(true);
    }
  });

  it("uses portable, deterministic names for the web and icon deliverables", () => {
    const web = expandExportPreset(
      exportPresetSchema.parse({
        name: "web-png",
        outputDirectory: "out\\assets",
        source,
      }),
    );
    expect(web[0]?.target).toMatchObject({ path: "out/assets/web-1200.png" });
    const icons = expandExportPreset(
      exportPresetSchema.parse({
        name: "icon-pack",
        outputDirectory: "out",
        source,
      }),
    );
    expect(
      icons.map((spec) =>
        spec.target.kind === "file" ? spec.target.path : "",
      ),
    ).toEqual([
      "out/icon-16.png",
      "out/icon-24.png",
      "out/icon-32.png",
      "out/icon-48.png",
      "out/icon-64.png",
      "out/icon-128.png",
      "out/icon-256.png",
      "out/icon-512.png",
    ]);
  });
});
