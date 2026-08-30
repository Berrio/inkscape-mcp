import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type PostscriptRasterizationPolicy = "rasterize-with-warning" | "reject";
export type PostscriptPreflight = {
  filterReferenceCount: number;
  maskReferenceCount: number;
  transparencyReferenceCount: number;
  warnings: readonly string[];
};
export type LegacyVectorEffectInspection = Omit<
  PostscriptPreflight,
  "warnings"
>;

/**
 * Detects SVG effects that PostScript cannot retain as native vector content.
 * The caller must opt in to Inkscape's flattening/rasterization rather than
 * silently accepting a visual-fidelity loss.
 */
export function preflightPostscriptExport(
  source: string,
  rasterizationPolicy: PostscriptRasterizationPolicy,
): PostscriptPreflight {
  const inspection = inspectLegacyVectorEffects(source);
  const warnings = [
    ...(inspection.filterReferenceCount > 0
      ? ["POSTSCRIPT_FILTER_RASTERIZATION_REQUIRED"]
      : []),
    ...(inspection.maskReferenceCount > 0 ||
    inspection.transparencyReferenceCount > 0
      ? ["POSTSCRIPT_TRANSPARENCY_RASTERIZATION_REQUIRED"]
      : []),
  ];
  if (warnings.length > 0 && rasterizationPolicy === "reject")
    throw new Error(
      "PostScript export requires rasterize-with-warning for filters, masks, or transparency",
    );
  return { ...inspection, warnings };
}

/** Inspects effects that legacy vector targets cannot preserve portably. */
export function inspectLegacyVectorEffects(
  source: string,
): LegacyVectorEffectInspection {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error(
      "PostScript export source does not meet the SVG safety policy",
    );
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  let filterReferenceCount = 0;
  let maskReferenceCount = 0;
  let transparencyReferenceCount = 0;
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    const style = parseStyle(element.getAttribute("style") ?? "");
    const attribute = (name: string): string | undefined =>
      element.getAttribute(name) ?? style.get(name);
    if (hasUrl(attribute("filter"))) filterReferenceCount += 1;
    if (hasUrl(attribute("mask"))) maskReferenceCount += 1;
    if (
      ["opacity", "fill-opacity", "stroke-opacity"].some((name) =>
        isPartialOpacity(attribute(name)),
      )
    )
      transparencyReferenceCount += 1;
  }
  return {
    filterReferenceCount,
    maskReferenceCount,
    transparencyReferenceCount,
  };
}

function parseStyle(value: string): Map<string, string> {
  return new Map(
    value.split(";").flatMap((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 1) return [];
      return [
        [
          entry.slice(0, separator).trim().toLowerCase(),
          entry.slice(separator + 1).trim(),
        ] as const,
      ];
    }),
  );
}

function hasUrl(value: string | undefined): boolean {
  return value !== undefined && /url\s*\(/iu.test(value);
}

function isPartialOpacity(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1;
}
