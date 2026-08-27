import { inspectSvgInventory } from "./inventory.js";

const GENERIC_FAMILIES = new Set([
  "cursive",
  "fantasy",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

export type SvgFontPreflight = {
  declaredFamilies: readonly string[];
  genericFamilies: readonly string[];
  missingFamilies: readonly string[];
  presentFamilies: readonly string[];
  warnings: readonly string[];
};

/**
 * Compares declared SVG font families against an already-discovered system
 * inventory.  It never claims that a matching family has the desired weight,
 * glyph coverage, embeddability, or identical renderer metrics.
 */
export function preflightSvgFonts(
  source: string,
  availableFamilies: readonly string[],
): SvgFontPreflight {
  const declaredFamilies = inspectSvgInventory(source, {
    detailLimit: 1_000,
  }).fontFamilies;
  const available = new Set(availableFamilies.map(normalizeFamily));
  const genericFamilies = declaredFamilies.filter((family) =>
    GENERIC_FAMILIES.has(normalizeFamily(family)),
  );
  const concrete = declaredFamilies.filter(
    (family) => !GENERIC_FAMILIES.has(normalizeFamily(family)),
  );
  const presentFamilies = concrete.filter((family) =>
    available.has(normalizeFamily(family)),
  );
  const missingFamilies = concrete.filter(
    (family) => !available.has(normalizeFamily(family)),
  );
  return {
    declaredFamilies,
    genericFamilies,
    missingFamilies,
    presentFamilies,
    warnings: [
      ...(missingFamilies.length > 0 ? ["MISSING_SYSTEM_FONT_FAMILIES"] : []),
      ...(genericFamilies.length > 0
        ? ["GENERIC_FONT_FAMILY_NOT_RESOLVED"]
        : []),
      "FONT_EMBEDDING_AND_GLYPH_COVERAGE_UNVERIFIED",
    ],
  };
}

export function normalizeFontFamilies(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function normalizeFamily(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/gu, "")
    .toLocaleLowerCase();
}
