import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import {
  planResize,
  type PageSize,
  type ResizeAnchor,
  type ResizeMode,
  type UserRect,
  type ViewportLength,
  convertPhysical,
  toMillimeters,
  toCssPixels,
} from "../geometry/index.js";
import { sanitizeSvg } from "../svg/index.js";
import { inspectContentResizeCssFidelity } from "./elements.js";

export type DocumentSpec = { page: PageSize; viewBox?: UserRect };
export type PageMargins = {
  bottom: ViewportLength;
  left: ViewportLength;
  right: ViewportLength;
  top: ViewportLength;
};
export type DocumentViewportWarning =
  | "VIEWBOX_MISSING_INFERRED_FROM_VIEWPORT"
  | "VIEWPORT_HEIGHT_DEFAULTED"
  | "VIEWPORT_HEIGHT_PERCENTAGE_UNRESOLVED"
  | "VIEWPORT_HEIGHT_UNITLESS_NORMALIZED"
  | "VIEWPORT_WIDTH_DEFAULTED"
  | "VIEWPORT_WIDTH_PERCENTAGE_UNRESOLVED"
  | "VIEWPORT_WIDTH_UNITLESS_NORMALIZED";
export type ViewportDimensionSource =
  "defaulted" | "explicit" | "percentage_fallback";
export type DocumentSettings = {
  ambiguousViewport: boolean;
  height: string;
  normalization: {
    height: { raw?: string; source: ViewportDimensionSource };
    viewBox: "explicit" | "inferred_from_viewport";
    width: { raw?: string; source: ViewportDimensionSource };
  };
  viewBox: UserRect;
  warnings: readonly DocumentViewportWarning[];
  width: string;
};
export type ContentResizeFidelity = {
  fidelity: "exact" | "unsupported";
  limitations: readonly string[];
};
const CONTENT_RESIZE_PERCENTAGE_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "height",
  "r",
  "rx",
  "ry",
  "stroke-width",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

export function parseViewportLength(value: string): PageSize["width"] {
  const match = value
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|q|px)?$/u);
  if (!match) throw new Error("Unsupported document viewport length");
  return {
    unit: (match[2] ?? "px") as PageSize["width"]["unit"],
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
  const rawViewBox = root.getAttribute("viewBox");
  const warnings: DocumentViewportWarning[] = [];
  const normalizedWidth = normalizeViewportDimension("width", width, warnings);
  const normalizedHeight = normalizeViewportDimension(
    "height",
    height,
    warnings,
  );
  const parts = rawViewBox?.trim().split(/[ ,]+/u).map(Number);
  if (
    parts !== undefined &&
    (parts.length !== 4 ||
      parts.some((value) => !Number.isFinite(value)) ||
      parts[2]! <= 0 ||
      parts[3]! <= 0)
  )
    throw new Error("Invalid viewBox");
  const viewBox =
    parts === undefined
      ? inferredViewBox(normalizedWidth.value, normalizedHeight.value)
      : {
          x: parts[0]!,
          y: parts[1]!,
          width: parts[2]!,
          height: parts[3]!,
        };
  if (parts === undefined)
    warnings.push("VIEWBOX_MISSING_INFERRED_FROM_VIEWPORT");
  return {
    ambiguousViewport:
      normalizedWidth.source === "percentage_fallback" ||
      normalizedHeight.source === "percentage_fallback",
    height: normalizedHeight.value,
    normalization: {
      height: {
        ...(height === null ? {} : { raw: height }),
        source: normalizedHeight.source,
      },
      viewBox: parts === undefined ? "inferred_from_viewport" : "explicit",
      width: {
        ...(width === null ? {} : { raw: width }),
        source: normalizedWidth.source,
      },
    },
    viewBox,
    warnings,
    width: normalizedWidth.value,
  };
}

export function resizePageOnlySvg(
  source: string,
  currentPage: PageSize,
  targetPage: PageSize,
  anchor: ResizeAnchor = "top_left",
): {
  svg: string;
  transform?: readonly [number, number, number, number, number, number];
  warnings: readonly string[];
} {
  assertMutationSafe(source);
  const settings = inspectSvgSettings(source);
  assertResizableViewport(settings);
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
    warnings: [...settings.warnings, ...plan.warnings],
  };
}

export function resizeContentSvg(
  source: string,
  currentPage: PageSize,
  targetPage: PageSize,
  mode: Extract<
    ResizeMode,
    "scale_content_contain" | "scale_content_cover" | "scale_content_stretch"
  >,
  anchor?: ResizeAnchor,
): {
  contentFidelity: "exact";
  contentLimitations: readonly [];
  svg: string;
  transform: readonly [number, number, number, number, number, number];
  warnings: readonly string[];
} {
  assertMutationSafe(source);
  const fidelity = inspectContentResizeFidelity(source);
  if (fidelity.fidelity !== "exact")
    throw new Error(
      `CONTENT_RESIZE_FIDELITY_UNSUPPORTED: ${fidelity.limitations.join(",")}`,
    );
  const settings = inspectSvgSettings(source);
  assertResizableViewport(settings);
  const plan = planResize({
    ...(anchor === undefined ? {} : { anchor }),
    currentPage,
    currentViewBox: settings.viewBox,
    mode,
    targetPage,
  });
  const transform = plan.contentTransform;
  if (!transform)
    throw new Error("Content resize requires a content transform");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  const [scaleX, , , scaleY, offsetX, offsetY] = transform;
  const targetCssWidth = toCssPixels(targetPage.width);
  const targetCssHeight = toCssPixels(targetPage.height);
  const translateX =
    settings.viewBox.x * (1 - scaleX) +
    offsetX * (plan.newViewBox.width / targetCssWidth);
  const translateY =
    settings.viewBox.y * (1 - scaleY) +
    offsetY * (plan.newViewBox.height / targetCssHeight);
  const group = document.createElementNS(
    root.namespaceURI ?? "http://www.w3.org/2000/svg",
    "g",
  );
  group.setAttribute(
    "transform",
    `matrix(${scaleX} 0 0 ${scaleY} ${translateX} ${translateY})`,
  );
  const renderable = Array.from(root.childNodes).filter(
    (node) =>
      node.nodeType === 1 &&
      !new Set(["defs", "desc", "metadata", "namedview", "style", "title"]).has(
        node.localName ?? "",
      ),
  );
  if (renderable.length > 0) {
    root.insertBefore(group, renderable[0] ?? null);
    for (const node of renderable) group.appendChild(node);
  }
  root.setAttribute("width", formatLength(targetPage.width));
  root.setAttribute("height", formatLength(targetPage.height));
  root.setAttribute(
    "viewBox",
    `${plan.newViewBox.x} ${plan.newViewBox.y} ${plan.newViewBox.width} ${plan.newViewBox.height}`,
  );
  return {
    contentFidelity: "exact",
    contentLimitations: [],
    svg: new XMLSerializer().serializeToString(document),
    transform,
    warnings:
      renderable.length === 0
        ? [...settings.warnings, ...plan.warnings, "NO_RENDERABLE_CONTENT"]
        : [...settings.warnings, ...plan.warnings],
  };
}

/** Reports every known feature whose meaning can change when content is wrapped. */
export function inspectContentResizeFidelity(
  source: string,
): ContentResizeFidelity {
  const css = inspectContentResizeCssFidelity(source);
  const limitations = new Set(css.limitations);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (
      /\bobjectBoundingBox\b/iu.test(
        element.getAttribute("clipPathUnits") ?? "",
      ) ||
      /\bobjectBoundingBox\b/iu.test(
        element.getAttribute("gradientUnits") ?? "",
      ) ||
      /\bobjectBoundingBox\b/iu.test(
        element.getAttribute("maskContentUnits") ?? "",
      ) ||
      /\bobjectBoundingBox\b/iu.test(
        element.getAttribute("patternContentUnits") ?? "",
      )
    )
      limitations.add("OBJECT_BOUNDING_BOX_UNSUPPORTED");
    if (
      /^non-scaling-stroke$/iu.test(element.getAttribute("vector-effect") ?? "")
    )
      limitations.add("NON_SCALING_STROKE_UNSUPPORTED");
    for (const attribute of CONTENT_RESIZE_PERCENTAGE_ATTRIBUTES) {
      const value = element.getAttribute(attribute) ?? "";
      if (/%/u.test(value)) limitations.add("PERCENTAGE_LENGTH_UNSUPPORTED");
    }
  }
  return {
    fidelity: limitations.size === 0 ? "exact" : "unsupported",
    limitations: [...limitations].sort(),
  };
}

/** Fits the page viewport to a supplied visual bounds rectangle without moving objects. */
export function fitPageToBoundsSvg(
  source: string,
  currentPage: PageSize,
  bounds: UserRect,
  margins: PageMargins,
  unit: ViewportLength["unit"],
): { page: PageSize; svg: string; warnings: readonly string[] } {
  assertFiniteBounds(bounds);
  assertMutationSafe(source);
  const settings = inspectSvgSettings(source);
  assertResizableViewport(settings);
  const scaleX = toCssPixels(currentPage.width) / settings.viewBox.width;
  const scaleY = toCssPixels(currentPage.height) / settings.viewBox.height;
  const marginLeft = toCssPixels(margins.left);
  const marginRight = toCssPixels(margins.right);
  const marginTop = toCssPixels(margins.top);
  const marginBottom = toCssPixels(margins.bottom);
  const page = {
    height: cssPixelsLength(
      bounds.height * scaleY + marginTop + marginBottom,
      unit,
    ),
    width: cssPixelsLength(
      bounds.width * scaleX + marginLeft + marginRight,
      unit,
    ),
  };
  const viewBox = {
    height: bounds.height + (marginTop + marginBottom) / scaleY,
    width: bounds.width + (marginLeft + marginRight) / scaleX,
    x: bounds.x - marginLeft / scaleX,
    y: bounds.y - marginTop / scaleY,
  };
  return writePageGeometry(source, settings, page, viewBox, [
    "FIT_USED_VISUAL_BOUNDS",
  ]);
}

/** Crops or expands a page by physical margins, preserving all object geometry. */
export function adjustPageMarginsSvg(
  source: string,
  currentPage: PageSize,
  margins: PageMargins,
  action: "crop" | "expand",
): { page: PageSize; svg: string; warnings: readonly string[] } {
  assertMutationSafe(source);
  const settings = inspectSvgSettings(source);
  assertResizableViewport(settings);
  const scaleX = toCssPixels(currentPage.width) / settings.viewBox.width;
  const scaleY = toCssPixels(currentPage.height) / settings.viewBox.height;
  const left = toCssPixels(margins.left);
  const right = toCssPixels(margins.right);
  const top = toCssPixels(margins.top);
  const bottom = toCssPixels(margins.bottom);
  const direction = action === "crop" ? 1 : -1;
  const targetWidth =
    toCssPixels(currentPage.width) - direction * (left + right);
  const targetHeight =
    toCssPixels(currentPage.height) - direction * (top + bottom);
  if (targetWidth <= 0 || targetHeight <= 0)
    throw new Error("Page margins leave no positive page area");
  const page = {
    height: cssPixelsLength(targetHeight, currentPage.height.unit),
    width: cssPixelsLength(targetWidth, currentPage.width.unit),
  };
  const viewBox = {
    height: settings.viewBox.height - (direction * (top + bottom)) / scaleY,
    width: settings.viewBox.width - (direction * (left + right)) / scaleX,
    x: settings.viewBox.x + (direction * left) / scaleX,
    y: settings.viewBox.y + (direction * top) / scaleY,
  };
  return writePageGeometry(source, settings, page, viewBox, [
    action === "crop" ? "PAGE_CROPPED" : "PAGE_EXPANDED",
  ]);
}

/** Swaps viewport orientation around the requested anchor without transforming objects. */
export function changePageOrientationSvg(
  source: string,
  currentPage: PageSize,
  anchor: ResizeAnchor = "top_left",
): { page: PageSize; svg: string; warnings: readonly string[] } {
  const targetPage = {
    height: convertViewportLength(currentPage.width, currentPage.height.unit),
    width: convertViewportLength(currentPage.height, currentPage.width.unit),
  };
  const result = resizePageOnlySvg(source, currentPage, targetPage, anchor);
  return {
    page: targetPage,
    ...result,
    warnings: [...result.warnings, "PAGE_ORIENTATION_CHANGED"],
  };
}

function assertMutationSafe(source: string): void {
  const sanitization = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitization.removed.length > 0)
    throw new Error("SVG must be sanitized before resizing");
}

function formatLength(length: PageSize["width"]): string {
  return `${length.value}${length.unit}`;
}

function normalizeViewportDimension(
  axis: "height" | "width",
  raw: string | null,
  warnings: DocumentViewportWarning[],
): { source: ViewportDimensionSource; value: string } {
  const upper = axis.toUpperCase() as "HEIGHT" | "WIDTH";
  if (raw === null || raw.trim() === "") {
    warnings.push(`VIEWPORT_${upper}_DEFAULTED` as DocumentViewportWarning);
    return { source: "defaulted", value: axis === "width" ? "300px" : "150px" };
  }
  const value = raw.trim();
  if (/^[0-9]+(?:\.[0-9]+)?%$/u.test(value)) {
    warnings.push(
      `VIEWPORT_${upper}_PERCENTAGE_UNRESOLVED` as DocumentViewportWarning,
    );
    return {
      source: "percentage_fallback",
      value: axis === "width" ? "300px" : "150px",
    };
  }
  const parsed = parseViewportLength(value);
  if (!/[a-z]+$/iu.test(value))
    warnings.push(
      `VIEWPORT_${upper}_UNITLESS_NORMALIZED` as DocumentViewportWarning,
    );
  return { source: "explicit", value: `${parsed.value}${parsed.unit}` };
}

function inferredViewBox(width: string, height: string): UserRect {
  return {
    height: toCssPixels(parseViewportLength(height)),
    width: toCssPixels(parseViewportLength(width)),
    x: 0,
    y: 0,
  };
}

function assertResizableViewport(settings: DocumentSettings): void {
  if (settings.ambiguousViewport)
    throw new Error(
      "Document viewport percentages require explicit normalization before resizing",
    );
}

function writePageGeometry(
  source: string,
  settings: DocumentSettings,
  page: PageSize,
  viewBox: UserRect,
  warnings: readonly string[],
): { page: PageSize; svg: string; warnings: readonly string[] } {
  if (viewBox.width <= 0 || viewBox.height <= 0)
    throw new Error("Page operation leaves no positive viewBox area");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  root.setAttribute("width", formatLength(page.width));
  root.setAttribute("height", formatLength(page.height));
  root.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  );
  return {
    page,
    svg: new XMLSerializer().serializeToString(document),
    warnings: [...settings.warnings, ...warnings],
  };
}

function cssPixelsLength(
  value: number,
  unit: ViewportLength["unit"],
): ViewportLength {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Page dimensions must be finite and positive");
  if (unit === "px") return { unit, value };
  return convertPhysical(
    { unit: "mm", value: toMillimeters({ unit: "px", value }) },
    unit,
  );
}
function convertViewportLength(
  source: ViewportLength,
  unit: ViewportLength["unit"],
): ViewportLength {
  return cssPixelsLength(toCssPixels(source), unit);
}
function assertFiniteBounds(bounds: UserRect): void {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    throw new Error("Fit bounds must be finite with positive dimensions");
}
