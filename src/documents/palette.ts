import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const COLOR = /^#[0-9a-f]{6}$/iu;
const PAINT_ATTRIBUTES = ["fill", "stroke", "stop-color"] as const;

export function inspectSvgPalette(
  source: string,
  limit = 128,
): {
  colors: readonly { color: string; uses: number }[];
  truncated: boolean;
} {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("Palette limit is invalid");
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before inspecting its palette");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const counts = new Map<string, number>();
  for (const element of Array.from(document.getElementsByTagName("*")))
    for (const name of PAINT_ATTRIBUTES) {
      const value = element.getAttribute(name)?.trim();
      if (!value || !COLOR.test(value)) continue;
      const color = value.toLowerCase();
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  const colors = [...counts.entries()]
    .sort(
      ([leftColor, leftUses], [rightColor, rightUses]) =>
        rightUses - leftUses || leftColor.localeCompare(rightColor),
    )
    .map(([color, uses]) => ({ color, uses }));
  return { colors: colors.slice(0, limit), truncated: colors.length > limit };
}

/** Replaces only explicitly mapped direct document-local palette colors. */
export function applySvgPalette(
  source: string,
  replacements: readonly { from: string; to: string }[],
): { replacements: number; svg: string } {
  if (replacements.length < 1 || replacements.length > 128)
    throw new Error("Palette replacement count is invalid");
  const normalized = new Map<string, string>();
  for (const replacement of replacements) {
    if (!COLOR.test(replacement.from) || !COLOR.test(replacement.to))
      throw new Error("Palette colors must be #rrggbb");
    const from = replacement.from.toLowerCase();
    if (normalized.has(from))
      throw new Error("Palette source colors are duplicate");
    normalized.set(from, replacement.to.toLowerCase());
  }
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before applying its palette");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  let count = 0;
  for (const element of Array.from(document.getElementsByTagName("*")))
    for (const name of PAINT_ATTRIBUTES) {
      const value = element.getAttribute(name)?.trim().toLowerCase();
      if (!value) continue;
      const replacement = normalized.get(value);
      if (!replacement) continue;
      element.setAttribute(name, replacement);
      count += 1;
    }
  return { replacements: count, svg: document.toString() };
}
