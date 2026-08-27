import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const COLOR = /^#[a-fA-F0-9]{6}$/u;

export type SvgPatternSpec = {
  background?: string | undefined;
  foreground: string;
  id: string;
  kind: "dots" | "stripes";
  size: number;
  transform?:
    readonly [number, number, number, number, number, number] | undefined;
  units?: "objectBoundingBox" | "userSpaceOnUse" | undefined;
  weight: number;
};

export function createSvgPattern(source: string, spec: SvgPatternSpec): string {
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Pattern ID already exists");
  ensureDefs(document).appendChild(createPatternElement(document, spec));
  return serialize(document);
}

export function updateSvgPattern(source: string, spec: SvgPatternSpec): string {
  const document = parseDocument(source);
  const existing = findById(document, spec.id);
  if (!existing || existing.localName !== "pattern")
    throw new Error("Pattern ID does not name an SVG pattern");
  existing.parentNode?.replaceChild(
    createPatternElement(document, spec),
    existing,
  );
  return serialize(document);
}

export function applySvgPattern(
  source: string,
  id: string,
  targetIds: readonly string[],
  paint: "fill" | "stroke",
): string {
  if (!SAFE_ID.test(id)) throw new Error("Pattern ID is invalid");
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  const pattern = findById(document, id);
  if (!pattern || pattern.localName !== "pattern")
    throw new Error("Pattern ID does not name an SVG pattern");
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.setAttribute(paint, `url(#${id})`);
  }
  return serialize(document);
}

export function deleteSvgPattern(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Pattern ID is invalid");
  const document = parseDocument(source);
  const pattern = findById(document, id);
  if (!pattern || pattern.localName !== "pattern")
    throw new Error("Pattern ID does not name an SVG pattern");
  assertUnreferenced(document, pattern, id);
  pattern.parentNode?.removeChild(pattern);
  return serialize(document);
}

function createPatternElement(
  document: XmlDocument,
  spec: SvgPatternSpec,
): XmlElement {
  validateSpec(spec);
  const pattern = document.createElementNS(SVG_NAMESPACE, "pattern");
  pattern.setAttribute("id", spec.id);
  pattern.setAttribute("patternUnits", spec.units ?? "userSpaceOnUse");
  pattern.setAttribute("width", String(spec.size));
  pattern.setAttribute("height", String(spec.size));
  if (spec.transform !== undefined)
    pattern.setAttribute(
      "patternTransform",
      `matrix(${spec.transform.join(" ")})`,
    );
  if (spec.background !== undefined) {
    const background = document.createElementNS(SVG_NAMESPACE, "rect");
    background.setAttribute("width", String(spec.size));
    background.setAttribute("height", String(spec.size));
    background.setAttribute("fill", spec.background.toLowerCase());
    pattern.appendChild(background);
  }
  if (spec.kind === "dots") {
    const dot = document.createElementNS(SVG_NAMESPACE, "circle");
    dot.setAttribute("cx", String(spec.size / 2));
    dot.setAttribute("cy", String(spec.size / 2));
    dot.setAttribute("r", String(spec.weight));
    dot.setAttribute("fill", spec.foreground.toLowerCase());
    pattern.appendChild(dot);
  } else {
    const stripe = document.createElementNS(SVG_NAMESPACE, "rect");
    stripe.setAttribute("width", String(spec.weight));
    stripe.setAttribute("height", String(spec.size));
    stripe.setAttribute("fill", spec.foreground.toLowerCase());
    pattern.appendChild(stripe);
  }
  return pattern;
}

function validateSpec(spec: SvgPatternSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Pattern ID is invalid");
  if (!COLOR.test(spec.foreground))
    throw new Error("Pattern foreground must be #rrggbb");
  if (spec.background !== undefined && !COLOR.test(spec.background))
    throw new Error("Pattern background must be #rrggbb");
  if (!Number.isFinite(spec.size) || spec.size <= 0 || spec.size > 1_000_000)
    throw new Error("Pattern size must be finite, positive and bounded");
  if (
    !Number.isFinite(spec.weight) ||
    spec.weight <= 0 ||
    spec.weight > spec.size / 2
  )
    throw new Error(
      "Pattern weight must be positive and at most half its size",
    );
  if (
    spec.units === "objectBoundingBox" &&
    (spec.size > 1 || spec.weight > 0.5)
  )
    throw new Error("Object bounding box pattern values must be normalized");
  if (
    spec.transform !== undefined &&
    (!spec.transform.every(Number.isFinite) ||
      spec.transform[0] * spec.transform[3] -
        spec.transform[1] * spec.transform[2] ===
        0)
  )
    throw new Error("Pattern transform must be finite and invertible");
}

function validateTargetIds(targetIds: readonly string[]): void {
  if (
    targetIds.length < 1 ||
    targetIds.length > 100 ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error("Pattern target IDs must be unique and bounded");
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
    throw new Error("SVG must be sanitized before changing patterns");
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
  pattern: XmlElement,
  id: string,
): void {
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === pattern || isDescendant(element, pattern)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesPattern(attribute.value, id))
        throw new Error("Deleting this pattern would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesPattern(element.textContent ?? "", id)
    )
      throw new Error("Deleting this pattern would break an SVG reference");
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

function referencesPattern(value: string, id: string): boolean {
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
