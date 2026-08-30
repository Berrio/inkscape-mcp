import {
  inspectSvgColorManagement,
  preflightSvgFonts,
  type SvgColorManagementInspection,
  type SvgFontPreflight,
} from "../documents/index.js";

export type ImportDependencyPolicy = {
  fonts: "record" | "reject-missing";
  profiles: "record" | "reject-unresolved";
};

export type ImportedSvgDependencies = {
  colorManagement: SvgColorManagementInspection;
  fontPreflight: SvgFontPreflight;
  policy: ImportDependencyPolicy;
};

/**
 * Records only the dependencies expressed by the sanitized SVG result. It
 * deliberately does not claim glyph coverage, font embedding permission, or
 * ICC conversion support that the local runtime cannot verify.
 */
export function inspectImportedSvgDependencies(
  svg: string,
  availableFontFamilies: readonly string[],
  policy: ImportDependencyPolicy,
): ImportedSvgDependencies {
  const fontPreflight = preflightSvgFonts(svg, availableFontFamilies);
  const colorManagement = inspectSvgColorManagement(svg);
  if (policy.fonts === "reject-missing" && fontPreflight.missingFamilies.length)
    throw new Error("Imported SVG requires unavailable system font families");
  if (
    policy.profiles === "reject-unresolved" &&
    colorManagement.unresolvedProfileNames.length
  )
    throw new Error("Imported SVG refers to unresolved color profile names");
  return { colorManagement, fontPreflight, policy };
}
