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

export type GradientStop = {
  color: string;
  offset: number;
  opacity?: number | undefined;
};
export type GradientSpec = {
  href?: string | undefined;
  id: string;
  kind: "linear" | "radial";
  spread?: "pad" | "reflect" | "repeat" | undefined;
  stops?: readonly GradientStop[] | undefined;
  transform?:
    readonly [number, number, number, number, number, number] | undefined;
  units?: "objectBoundingBox" | "userSpaceOnUse" | undefined;
  x1?: number | undefined;
  x2?: number | undefined;
  y1?: number | undefined;
  y2?: number | undefined;
  cx?: number | undefined;
  cy?: number | undefined;
  fx?: number | undefined;
  fy?: number | undefined;
  r?: number | undefined;
};

export function createSvgGradient(source: string, spec: GradientSpec): string {
  const document = parseDocument(source);
  if (findById(document, spec.id))
    throw new Error("Gradient ID already exists");
  const defs = ensureDefs(document);
  defs.appendChild(createGradientElement(document, spec));
  return serialize(document);
}

export function updateSvgGradient(source: string, spec: GradientSpec): string {
  const document = parseDocument(source);
  const existing = findById(document, spec.id);
  if (
    !existing ||
    (existing.localName !== "linearGradient" &&
      existing.localName !== "radialGradient")
  )
    throw new Error("Gradient ID does not name an SVG gradient");
  const replacement = createGradientElement(document, spec);
  existing.parentNode?.replaceChild(replacement, existing);
  return serialize(document);
}

export function deleteSvgGradient(source: string, id: string): string {
  const document = parseDocument(source);
  const gradient = findById(document, id);
  if (
    !gradient ||
    (gradient.localName !== "linearGradient" &&
      gradient.localName !== "radialGradient")
  )
    throw new Error("Gradient ID does not name an SVG gradient");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === gradient || isDescendant(element, gradient)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesGradient(attribute.value, id))
        throw new Error("Deleting this gradient would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesGradient(element.textContent ?? "", id)
    )
      throw new Error("Deleting this gradient would break an SVG reference");
  }
  gradient.parentNode?.removeChild(gradient);
  return serialize(document);
}

export function applySvgGradient(
  source: string,
  id: string,
  targetIds: readonly string[],
  paint: "fill" | "stroke",
): string {
  if (!SAFE_ID.test(id)) throw new Error("Gradient ID is invalid");
  if (
    targetIds.length < 1 ||
    targetIds.length > 100 ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error("Gradient target IDs must be unique and bounded");
  const document = parseDocument(source);
  const gradient = findById(document, id);
  if (
    !gradient ||
    (gradient.localName !== "linearGradient" &&
      gradient.localName !== "radialGradient")
  )
    throw new Error("Gradient ID does not name an SVG gradient");
  for (const targetId of targetIds) {
    if (!SAFE_ID.test(targetId)) throw new Error("Shape ID is invalid");
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.setAttribute(paint, `url(#${id})`);
  }
  return serialize(document);
}

function createGradientElement(
  document: XmlDocument,
  spec: GradientSpec,
): XmlElement {
  validateGradientSpec(spec);
  const element = document.createElementNS(
    SVG_NAMESPACE,
    spec.kind === "linear" ? "linearGradient" : "radialGradient",
  );
  element.setAttribute("id", spec.id);
  if (spec.href !== undefined) {
    assertReusableGradient(document, spec);
    element.setAttribute("href", `#${spec.href}`);
  }
  if (spec.units !== undefined)
    element.setAttribute("gradientUnits", spec.units);
  if (spec.spread !== undefined)
    element.setAttribute("spreadMethod", spec.spread);
  if (spec.transform !== undefined)
    element.setAttribute(
      "gradientTransform",
      `matrix(${spec.transform.join(" ")})`,
    );
  if (spec.kind === "linear") {
    setOptionalNumber(element, "x1", spec.x1);
    setOptionalNumber(element, "y1", spec.y1);
    setOptionalNumber(element, "x2", spec.x2);
    setOptionalNumber(element, "y2", spec.y2);
  } else {
    setOptionalNumber(element, "cx", spec.cx);
    setOptionalNumber(element, "cy", spec.cy);
    setOptionalNumber(element, "r", spec.r);
    setOptionalNumber(element, "fx", spec.fx);
    setOptionalNumber(element, "fy", spec.fy);
  }
  for (const stop of spec.stops ?? []) {
    const child = document.createElementNS(SVG_NAMESPACE, "stop");
    child.setAttribute("offset", String(stop.offset));
    child.setAttribute("stop-color", stop.color.toLowerCase());
    if (stop.opacity !== undefined)
      child.setAttribute("stop-opacity", String(stop.opacity));
    element.appendChild(child);
  }
  return element;
}

function validateGradientSpec(spec: GradientSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Gradient ID is invalid");
  if (
    (spec.stops === undefined && spec.href === undefined) ||
    (spec.stops !== undefined &&
      (spec.stops.length < 2 || spec.stops.length > 64))
  )
    throw new Error("Gradient requires between two and 64 stops");
  if (spec.href !== undefined && !SAFE_ID.test(spec.href))
    throw new Error("Gradient href ID is invalid");
  let previous = -1;
  for (const stop of spec.stops ?? []) {
    if (!COLOR.test(stop.color))
      throw new Error("Gradient stop color must be #rrggbb");
    if (
      !Number.isFinite(stop.offset) ||
      stop.offset < 0 ||
      stop.offset > 1 ||
      stop.offset < previous
    )
      throw new Error(
        "Gradient stop offsets must be finite, sorted and between zero and one",
      );
    if (
      stop.opacity !== undefined &&
      (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)
    )
      throw new Error("Gradient stop opacity must be between zero and one");
    previous = stop.offset;
  }
  const numbers = [
    spec.x1,
    spec.y1,
    spec.x2,
    spec.y2,
    spec.cx,
    spec.cy,
    spec.r,
    spec.fx,
    spec.fy,
    ...(spec.transform ?? []),
  ].filter((value): value is number => value !== undefined);
  if (numbers.some((value) => !Number.isFinite(value)))
    throw new Error("Gradient coordinates must be finite");
  if (spec.kind === "radial" && spec.r !== undefined && spec.r <= 0)
    throw new Error("Radial gradient r must be positive");
  if (
    spec.transform !== undefined &&
    spec.transform[0] * spec.transform[3] -
      spec.transform[1] * spec.transform[2] ===
      0
  )
    throw new Error("Gradient transform must be invertible");
}

function assertReusableGradient(
  document: XmlDocument,
  spec: GradientSpec,
): void {
  if (spec.href === undefined) return;
  if (spec.href === spec.id) throw new Error("Gradient cannot reuse itself");
  const expectedName =
    spec.kind === "linear" ? "linearGradient" : "radialGradient";
  let current = findById(document, spec.href);
  const seen = new Set([spec.id]);
  while (current !== undefined) {
    const id = current.getAttribute("id");
    if (!id || current.localName !== expectedName)
      throw new Error(
        "Gradient href must name a local gradient of the same kind",
      );
    if (seen.has(id)) throw new Error("Gradient reuse would create a cycle");
    seen.add(id);
    const href = current.getAttribute("href");
    if (href === null) return;
    if (!href.startsWith("#")) throw new Error("Gradient href is not local");
    current = findById(document, href.slice(1));
  }
  throw new Error("Gradient href does not exist");
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing gradients");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function ensureDefs(document: XmlDocument): XmlElement {
  const existing = Array.from(document.getElementsByTagName("defs"))[0];
  if (existing) return existing;
  const root = document.documentElement!;
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  root.insertBefore(defs, root.firstChild);
  return defs;
}

function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}

function setOptionalNumber(
  element: XmlElement,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) element.setAttribute(name, String(value));
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

function referencesGradient(value: string, id: string): boolean {
  return (
    new RegExp(
      `url\\(\\s*(?:['"])?#${escapeRegExp(id)}(?:['"])?\\s*[)]`,
      "iu",
    ).test(value) || value.trim() === `#${id}`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
