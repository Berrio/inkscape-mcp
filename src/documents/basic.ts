import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import {
  planResize,
  type PageSize,
  type ResizeAnchor,
  type UserRect,
} from "../geometry/index.js";
import { sanitizeSvg } from "../svg/index.js";

export type DocumentSpec = { page: PageSize; viewBox?: UserRect };
export type DocumentSettings = {
  height: string;
  viewBox: UserRect;
  width: string;
};

export function parseViewportLength(value: string): PageSize["width"] {
  const match = value
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|q|px)$/u);
  if (!match) throw new Error("Unsupported document viewport length");
  return {
    unit: match[2] as PageSize["width"]["unit"],
    value: Number(match[1]),
  };
}

export function createSvgDocument(spec: DocumentSpec): string {
  const viewBox = spec.viewBox ?? {
    x: 0,
    y: 0,
    width: spec.page.width.value,
    height: spec.page.height.value,
  };
  if (
    !Number.isFinite(viewBox.x) ||
    !Number.isFinite(viewBox.y) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  )
    throw new Error("viewBox must be finite with positive dimensions");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${formatLength(spec.page.width)}" height="${formatLength(spec.page.height)}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"></svg>`;
}

export function inspectSvgSettings(source: string): DocumentSettings {
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const root = new DOMParser().parseFromString(
    safe.svg,
    "image/svg+xml",
  ).documentElement;
  if (!root) throw new Error("SVG root is missing");
  const width = root.getAttribute("width");
  const height = root.getAttribute("height");
  const viewBox = root.getAttribute("viewBox");
  if (!width || !height || !viewBox)
    throw new Error("Document must define width, height and viewBox");
  const parts = viewBox.trim().split(/[ ,]+/u).map(Number);
  if (
    parts.length !== 4 ||
    parts.some((value) => !Number.isFinite(value)) ||
    parts[2]! <= 0 ||
    parts[3]! <= 0
  )
    throw new Error("Invalid viewBox");
  return {
    height,
    viewBox: {
      x: parts[0]!,
      y: parts[1]!,
      width: parts[2]!,
      height: parts[3]!,
    },
    width,
  };
}

export function resizePageOnlySvg(
  source: string,
  currentPage: PageSize,
  targetPage: PageSize,
  anchor: ResizeAnchor = "top_left",
): { svg: string; warnings: readonly string[] } {
  const settings = inspectSvgSettings(source);
  const plan = planResize({
    currentPage,
    currentViewBox: settings.viewBox,
    anchor,
    mode: "page_only",
    targetPage,
  });
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  root.setAttribute("width", formatLength(targetPage.width));
  root.setAttribute("height", formatLength(targetPage.height));
  root.setAttribute(
    "viewBox",
    `${plan.newViewBox.x} ${plan.newViewBox.y} ${plan.newViewBox.width} ${plan.newViewBox.height}`,
  );
  return {
    svg: new XMLSerializer().serializeToString(document),
    warnings: plan.warnings,
  };
}

function formatLength(length: PageSize["width"]): string {
  return `${length.value}${length.unit}`;
}
