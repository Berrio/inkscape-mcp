import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const BLEND_MODES = [
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
] as const;

export type SvgBlurFilterSpec = { id: string; stdDeviation: number };
export type SvgDropShadowFilterSpec = {
  id: string;
  stdDeviation: number;
  dx: number;
  dy: number;
};
export type SvgBlendFilterSpec = {
  id: string;
  mode: (typeof BLEND_MODES)[number];
  input?: "BackgroundImage" | "SourceGraphic" | undefined;
};
export type SvgColorMatrixFilterSpec = {
  id: string;
  values: readonly number[];
};
export type SvgFilterSpec =
  | ({ kind: "blur" } & SvgBlurFilterSpec)
  | ({ kind: "drop_shadow" } & SvgDropShadowFilterSpec)
  | ({ kind: "blend" } & SvgBlendFilterSpec)
  | ({ kind: "color_matrix" } & SvgColorMatrixFilterSpec);

export function createSvgBlurFilter(
  source: string,
  spec: SvgBlurFilterSpec,
): string {
  return createSvgFilter(source, { ...spec, kind: "blur" });
}

export function createSvgDropShadowFilter(
  source: string,
  spec: SvgDropShadowFilterSpec,
): string {
  return createSvgFilter(source, { ...spec, kind: "drop_shadow" });
}

export function createSvgFilter(source: string, spec: SvgFilterSpec): string {
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Filter ID already exists");
  ensureDefs(document).appendChild(createFilterElement(document, spec));
  return serialize(document);
}

export function updateSvgFilter(source: string, spec: SvgFilterSpec): string {
  const document = parseDocument(source);
  const existing = findById(document, spec.id);
  if (!existing || existing.localName !== "filter")
    throw new Error("Filter ID does not name an SVG filter");
  existing.parentNode?.replaceChild(
    createFilterElement(document, spec),
    existing,
  );
  return serialize(document);
}

export function deleteSvgFilter(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Filter ID is invalid");
  const document = parseDocument(source);
  const filter = findById(document, id);
  if (!filter || filter.localName !== "filter")
    throw new Error("Filter ID does not name an SVG filter");
  assertUnreferenced(document, filter, id);
  filter.parentNode?.removeChild(filter);
  return serialize(document);
}

export function applySvgFilter(
  source: string,
  id: string,
  targetIds: readonly string[],
): string {
  if (!SAFE_ID.test(id)) throw new Error("Filter ID is invalid");
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  const filter = findById(document, id);
  if (!filter || filter.localName !== "filter")
    throw new Error("Filter ID does not name an SVG filter");
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.setAttribute("filter", `url(#${id})`);
  }
  return serialize(document);
}

export function releaseSvgFilter(
  source: string,
  targetIds: readonly string[],
): string {
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.removeAttribute("filter");
  }
  return serialize(document);
}

function createFilterElement(
  document: XmlDocument,
  spec: SvgFilterSpec,
): XmlElement {
  validateSpec(spec);
  const filter = document.createElementNS(SVG_NAMESPACE, "filter");
  filter.setAttribute("id", spec.id);
  if (spec.kind === "blur") {
    const primitive = document.createElementNS(SVG_NAMESPACE, "feGaussianBlur");
    primitive.setAttribute("stdDeviation", String(spec.stdDeviation));
    filter.appendChild(primitive);
  } else if (spec.kind === "drop_shadow") {
    const primitive = document.createElementNS(SVG_NAMESPACE, "feDropShadow");
    primitive.setAttribute("dx", String(spec.dx));
    primitive.setAttribute("dy", String(spec.dy));
    primitive.setAttribute("stdDeviation", String(spec.stdDeviation));
    filter.appendChild(primitive);
  } else if (spec.kind === "blend") {
    const primitive = document.createElementNS(SVG_NAMESPACE, "feBlend");
    primitive.setAttribute("in", "SourceGraphic");
    primitive.setAttribute("in2", spec.input ?? "BackgroundImage");
    primitive.setAttribute("mode", spec.mode);
    filter.appendChild(primitive);
  } else {
    const primitive = document.createElementNS(SVG_NAMESPACE, "feColorMatrix");
    primitive.setAttribute("type", "matrix");
    primitive.setAttribute("values", spec.values.join(" "));
    filter.appendChild(primitive);
  }
  return filter;
}

function validateSpec(spec: SvgFilterSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Filter ID is invalid");
  if (
    spec.kind === "blur" &&
    (!Number.isFinite(spec.stdDeviation) || spec.stdDeviation < 0)
  )
    throw new Error("Blur deviation must be finite and nonnegative");
  if (
    spec.kind === "drop_shadow" &&
    (![spec.stdDeviation, spec.dx, spec.dy].every(Number.isFinite) ||
      spec.stdDeviation < 0)
  )
    throw new Error("Shadow values are invalid");
  if (spec.kind === "blend" && !BLEND_MODES.includes(spec.mode))
    throw new Error("Blend mode is invalid");
  if (
    spec.kind === "color_matrix" &&
    (spec.values.length !== 20 || !spec.values.every(Number.isFinite))
  )
    throw new Error("Color matrix requires exactly 20 finite values");
}

function validateTargetIds(targetIds: readonly string[]): void {
  if (
    targetIds.length < 1 ||
    targetIds.length > 100 ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error("Filter target IDs must be unique and bounded");
  if (targetIds.some((id) => !SAFE_ID.test(id)))
    throw new Error("Shape ID is invalid");
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing filters");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function ensureDefs(document: XmlDocument): XmlElement {
  const existing = Array.from(document.getElementsByTagName("defs"))[0];
  if (existing) return existing;
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  const root = document.documentElement!;
  root.insertBefore(defs, root.firstChild);
  return defs;
}

function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}

function assertUnreferenced(
  document: XmlDocument,
  filter: XmlElement,
  id: string,
): void {
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === filter || isDescendant(element, filter)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesFilter(attribute.value, id))
        throw new Error("Deleting this filter would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesFilter(element.textContent ?? "", id)
    )
      throw new Error("Deleting this filter would break an SVG reference");
  }
}

function isDescendant(element: XmlElement, ancestor: XmlElement): boolean {
  for (
    let parent = element.parentNode;
    parent?.nodeType === 1;
    parent = parent.parentNode
  )
    if (parent === ancestor) return true;
  return false;
}

function referencesFilter(value: string, id: string): boolean {
  return new RegExp(
    `url\\(\\s*(?:['"])?#${escapeRegExp(id)}(?:['"])?\\s*[)]`,
    "iu",
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
