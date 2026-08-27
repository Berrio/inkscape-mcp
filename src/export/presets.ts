import type { ExportPreset, ExportSpec } from "./spec.js";

/**
 * Expands a named, deterministic deliverable into ordinary export specs. The
 * caller still runs the normal batch planner, renderer and verifier, so a
 * preset cannot bypass workspace, collision or publication protections.
 */
export function expandExportPreset(
  preset: ExportPreset,
): readonly ExportSpec[] {
  const directory = preset.outputDirectory
    .replace(/\\/gu, "/")
    .replace(/\/+$/u, "");
  const target = (name: string) => ({
    kind: "file" as const,
    overwrite: false,
    path: `${directory}/${name}`,
  });
  const source = preset.source;

  switch (preset.name) {
    case "print-a4-pdf":
      return [
        {
          area: { kind: "document" },
          filters: "preserve",
          format: "pdf",
          source,
          target: target("print-a4.pdf"),
          text: "preserve",
        },
      ];
    case "print-pdf-300dpi":
      return [
        {
          area: { kind: "document" },
          filterRasterDpi: 300,
          filters: "preserve",
          format: "pdf",
          source,
          target: target("print-300dpi.pdf"),
          text: "preserve",
        },
      ];
    case "web-png":
      return [
        {
          area: { kind: "drawing" },
          background: { mode: "transparent" },
          format: "png",
          size: { mode: "width", widthPx: 1200 },
          source,
          target: target("web-1200.png"),
        },
      ];
    case "web-asset-pack":
      return [
        {
          area: { kind: "document" },
          format: "plain-svg",
          resourcePolicy: "preserve-local",
          source,
          target: target("web.svg"),
          text: "preserve",
        },
        ...[1, 2, 3].map((scale) => ({
          area: { kind: "drawing" as const },
          background: { mode: "transparent" as const },
          format: "png" as const,
          size: { mode: "width" as const, widthPx: 1200 * scale },
          source,
          target: target(`web-${scale}x.png`),
        })),
      ];
    case "plain-svg":
      return [
        {
          area: { kind: "document" },
          format: "plain-svg",
          resourcePolicy: "preserve-local",
          source,
          target: target("plain.svg"),
          text: "preserve",
        },
      ];
    case "icon-pack":
      return [16, 24, 32, 48, 64, 128, 256, 512].map((size) => ({
        area: { kind: "drawing" as const },
        background: { mode: "transparent" as const },
        format: "png" as const,
        size: {
          allowDistortion: true,
          heightPx: size,
          mode: "exact" as const,
          widthPx: size,
        },
        source,
        target: target(`icon-${size}.png`),
      }));
  }
}
