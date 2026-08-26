import { toCssPixels, type PageSize } from "../geometry/index.js";

import {
  adjustPageMarginsSvg,
  inspectSvgSettings,
  parseViewportLength,
  type PageMargins,
} from "./basic.js";
import { listSvgPages, updateSvgPage } from "./pages.js";

/**
 * Expands only an export copy. Explicit Inkscape pages define PDF page boxes,
 * while a document without explicit pages uses its root viewport instead.
 */
export function expandPdfMarginsSvg(
  source: string,
  margins: PageMargins,
  pageIds?: readonly string[],
): { svg: string; warnings: readonly string[] } {
  const pages = listSvgPages(source);
  if (pages.length === 0) {
    const settings = inspectSvgSettings(source);
    const page: PageSize = {
      height: parseViewportLength(settings.height),
      width: parseViewportLength(settings.width),
    };
    const expanded = adjustPageMarginsSvg(source, page, margins, "expand");
    return {
      svg: expanded.svg,
      warnings: ["PDF_MARGIN_EXPANDED_TEMPORARY"],
    };
  }
  const requested = pageIds ?? pages.map((page) => page.id);
  if (
    requested.length < 1 ||
    new Set(requested).size !== requested.length ||
    requested.some((id) => !pages.some((page) => page.id === id))
  )
    throw new Error("PDF margin pages are invalid");
  const settings = inspectSvgSettings(source);
  const viewport = {
    height: parseViewportLength(settings.height),
    width: parseViewportLength(settings.width),
  };
  const scaleX = settings.viewBox.width / toCssPixels(viewport.width);
  const scaleY = settings.viewBox.height / toCssPixels(viewport.height);
  const left = toCssPixels(margins.left) * scaleX;
  const right = toCssPixels(margins.right) * scaleX;
  const top = toCssPixels(margins.top) * scaleY;
  const bottom = toCssPixels(margins.bottom) * scaleY;
  if (![left, right, top, bottom].every(Number.isFinite))
    throw new Error("PDF margins must be finite");
  let svg = source;
  for (const id of requested) {
    const page = pages.find((candidate) => candidate.id === id)!;
    svg = updateSvgPage(svg, id, {
      height: page.height + top + bottom,
      width: page.width + left + right,
      x: page.x - left,
      y: page.y - top,
    }).svg;
  }
  return { svg, warnings: ["PDF_MARGIN_EXPANDED_TEMPORARY"] };
}
