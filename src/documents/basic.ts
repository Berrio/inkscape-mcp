import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import {
  planResize,
  type PageSize,
  type ResizeAnchor,
  type ResizeMode,
  type UserRect,
  toCssPixels,
} from "../geometry/index.js";
import { sanitizeSvg } from "../svg/index.js";

export type DocumentSpec = { page: PageSize; viewBox?: UserRect };
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
): { svg: string; warnings: readonly string[] } {
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
): { svg: string; warnings: readonly string[] } {
  assertMutationSafe(source);
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
    svg: new XMLSerializer().serializeToString(document),
    warnings:
      renderable.length === 0
        ? [...settings.warnings, ...plan.warnings, "NO_RENDERABLE_CONTENT"]
        : [...settings.warnings, ...plan.warnings],
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
