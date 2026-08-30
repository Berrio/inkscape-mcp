import { describe, expect, it } from "vitest";

import { pagePresetReferenceSchema } from "../../src/documents/index.js";
import {
  expandExportPreset,
  exportPresetSchema,
  planExportBatch,
  resolveExportPresetDefinitions,
} from "../../src/export/index.js";

const source = {
  expectedRevision: "a".repeat(64),
  path: "source.svg",
};

describe("export presets", () => {
  it("accepts only the versioned, closed page preset reference", () => {
    expect(
      pagePresetReferenceSchema.parse({
        name: "a4-portrait",
        schema: "inkscape-mcp-page-preset/v1",
      }),
    ).toMatchObject({ name: "a4-portrait" });
    expect(() =>
      pagePresetReferenceSchema.parse({
        name: "a4-portrait",
        schema: "inkscape-mcp-page-preset/v2",
      }),
    ).toThrow();
    expect(() =>
      pagePresetReferenceSchema.parse({
        name: "a4-portrait",
        schema: "inkscape-mcp-page-preset/v1",
        unknown: true,
      }),
    ).toThrow();
  });

  it("expands every public preset into collision-free ordinary specs", () => {
    for (const name of [
      "print-a4-pdf",
      "print-pdf-300dpi",
      "web-png",
      "web-asset-pack",
      "plain-svg",
      "icon-pack",
    ] as const) {
      const preset = exportPresetSchema.parse({
        name,
        outputDirectory: "deliverables",
        source,
      });
      const specs = expandExportPreset(preset);
      expect(specs.length).toBe(
        name === "icon-pack" ? 8 : name === "web-asset-pack" ? 4 : 1,
      );
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

  it("versions social presets, records their metadata, and accepts bounded size overrides", () => {
    const preset = exportPresetSchema.parse({
      metadata: {
        createdAt: "2026-08-29T00:00:00Z",
        sourceLabel: "campaign-brief",
      },
      name: "social-landscape",
      outputDirectory: "social",
      overrides: { heightPx: 675, widthPx: 1200 },
      source,
    });
    expect(preset.schema).toBe("inkscape-mcp-export-preset/v1");
    expect(expandExportPreset(preset)[0]).toMatchObject({
      size: { heightPx: 675, mode: "exact", widthPx: 1200 },
      target: { path: "social/social-landscape.png" },
    });
    expect(() =>
      exportPresetSchema.parse({
        name: "social-square",
        outputDirectory: "social",
        source,
      }),
    ).toThrow("require source metadata");
    expect(() =>
      exportPresetSchema.parse({
        name: "web-png",
        outputDirectory: "web",
        overrides: { widthPx: 100 },
        source,
      }),
    ).toThrow("only supported by social");
  });

  it("resolves versioned preset inheritance and rejects cycles", () => {
    const resolved = resolveExportPresetDefinitions([
      {
        id: "print-base",
        overrides: { text: "preserve" },
        schema: "inkscape-mcp-export-preset-definition/v1",
      },
      {
        extends: "print-base",
        id: "outlined-print",
        overrides: { text: "paths" },
        schema: "inkscape-mcp-export-preset-definition/v1",
      },
    ]);
    expect(resolved.get("outlined-print")).toEqual({ text: "paths" });
    expect(() =>
      resolveExportPresetDefinitions([
        {
          extends: "second",
          id: "first",
          overrides: {},
          schema: "inkscape-mcp-export-preset-definition/v1",
        },
        {
          extends: "first",
          id: "second",
          overrides: {},
          schema: "inkscape-mcp-export-preset-definition/v1",
        },
      ]),
    ).toThrow("inheritance has a cycle");
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
