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
const MARKER_TARGETS = new Set(["line", "path", "polygon", "polyline"]);

export type SvgMarkerSpec = {
  color: string;
  id: string;
  kind: "arrow" | "dot";
  orient?: "auto" | "auto-start-reverse" | undefined;
  size: number;
  units?: "strokeWidth" | "userSpaceOnUse" | undefined;
};

export function createSvgMarker(source: string, spec: SvgMarkerSpec): string {
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Marker ID already exists");
  ensureDefs(document).appendChild(createMarker(document, spec));
  return serialize(document);
}

export function updateSvgMarker(source: string, spec: SvgMarkerSpec): string {
  const document = parseDocument(source);
  const existing = findById(document, spec.id);
  if (!existing || existing.localName !== "marker")
    throw new Error("Marker ID does not name an SVG marker");
  existing.parentNode?.replaceChild(createMarker(document, spec), existing);
  return serialize(document);
}

export function applySvgMarker(
  source: string,
  id: string,
  targetIds: readonly string[],
  position: "start" | "mid" | "end",
): string {
  if (!SAFE_ID.test(id)) throw new Error("Marker ID is invalid");
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  const marker = findById(document, id);
  if (!marker || marker.localName !== "marker")
    throw new Error("Marker ID does not name an SVG marker");
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (
      !target ||
      target.localName === null ||
      !MARKER_TARGETS.has(target.localName)
    )
      throw new Error("Marker targets must be line, path, polygon or polyline");
    target.setAttribute(`marker-${position}`, `url(#${id})`);
  }
  return serialize(document);
}

export function deleteSvgMarker(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Marker ID is invalid");
  const document = parseDocument(source);
  const marker = findById(document, id);
  if (!marker || marker.localName !== "marker")
    throw new Error("Marker ID does not name an SVG marker");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === marker || isDescendant(element, marker)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesMarker(attribute.value, id))
        throw new Error("Deleting this marker would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesMarker(element.textContent ?? "", id)
    )
      throw new Error("Deleting this marker would break an SVG reference");
  }
  marker.parentNode?.removeChild(marker);
  return serialize(document);
}

function createMarker(document: XmlDocument, spec: SvgMarkerSpec): XmlElement {
  validateSpec(spec);
  const marker = document.createElementNS(SVG_NAMESPACE, "marker");
  marker.setAttribute("id", spec.id);
  marker.setAttribute("markerUnits", spec.units ?? "strokeWidth");
  marker.setAttribute("markerWidth", String(spec.size));
  marker.setAttribute("markerHeight", String(spec.size));
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refY", "5");
  marker.setAttribute("orient", spec.orient ?? "auto");
  if (spec.kind === "arrow") {
    marker.setAttribute("refX", "10");
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", spec.color.toLowerCase());
    marker.appendChild(path);
  } else {
    marker.setAttribute("refX", "5");
    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    circle.setAttribute("cx", "5");
    circle.setAttribute("cy", "5");
    circle.setAttribute("r", "3");
    circle.setAttribute("fill", spec.color.toLowerCase());
    marker.appendChild(circle);
  }
  return marker;
}

function validateSpec(spec: SvgMarkerSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Marker ID is invalid");
  if (!COLOR.test(spec.color)) throw new Error("Marker color must be #rrggbb");
  if (!Number.isFinite(spec.size) || spec.size <= 0 || spec.size > 1_000)
    throw new Error("Marker size must be finite, positive and bounded");
}

function validateTargetIds(targetIds: readonly string[]): void {
  if (
    targetIds.length < 1 ||
    targetIds.length > 100 ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error("Marker target IDs must be unique and bounded");
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
    throw new Error("SVG must be sanitized before changing markers");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function ensureDefs(document: XmlDocument): XmlElement {
  const existing = Array.from(document.getElementsByTagName("defs"))[0];
  if (existing) return existing;
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  document.documentElement!.insertBefore(
    defs,
    document.documentElement!.firstChild,
  );
  return defs;
}
function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
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
function referencesMarker(value: string, id: string): boolean {
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
