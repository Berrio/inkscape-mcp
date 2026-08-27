import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type SvgClipPathSpec = {
  height: number;
  id: string;
  units?: "objectBoundingBox" | "userSpaceOnUse" | undefined;
  width: number;
  x: number;
  y: number;
};

export type SvgMaskSpec = {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
};

export function createSvgRectClipPath(
  source: string,
  spec: SvgClipPathSpec,
): string {
  validateClipSpec(spec);
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Clip ID already exists");
  const clip = document.createElementNS(SVG_NAMESPACE, "clipPath");
  clip.setAttribute("id", spec.id);
  clip.setAttribute("clipPathUnits", spec.units ?? "userSpaceOnUse");
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("x", String(spec.x));
  rect.setAttribute("y", String(spec.y));
  rect.setAttribute("width", String(spec.width));
  rect.setAttribute("height", String(spec.height));
  clip.appendChild(rect);
  ensureDefs(document).appendChild(clip);
  return serialize(document);
}

export function applySvgClipPath(
  source: string,
  id: string,
  targetIds: readonly string[],
): string {
  if (!SAFE_ID.test(id)) throw new Error("Clip ID is invalid");
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  const clip = findById(document, id);
  if (!clip || clip.localName !== "clipPath")
    throw new Error("Clip ID does not name an SVG clipPath");
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    if (target === clip || isDescendant(target, clip))
      throw new Error("A clipPath cannot clip itself or its contents");
    target.setAttribute("clip-path", `url(#${id})`);
  }
  return serialize(document);
}

export function releaseSvgClipPath(
  source: string,
  targetIds: readonly string[],
): string {
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.removeAttribute("clip-path");
  }
  return serialize(document);
}

export function deleteSvgClipPath(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Clip ID is invalid");
  const document = parseDocument(source);
  const clip = findById(document, id);
  if (!clip || clip.localName !== "clipPath")
    throw new Error("Clip ID does not name an SVG clipPath");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === clip || isDescendant(element, clip)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesClip(attribute.value, id))
        throw new Error("Deleting this clipPath would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesClip(element.textContent ?? "", id)
    )
      throw new Error("Deleting this clipPath would break an SVG reference");
  }
  clip.parentNode?.removeChild(clip);
  return serialize(document);
}

export function createSvgRectMask(source: string, spec: SvgMaskSpec): string {
  validateMaskSpec(spec);
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Mask ID already exists");
  const mask = document.createElementNS(SVG_NAMESPACE, "mask");
  mask.setAttribute("id", spec.id);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("maskContentUnits", "userSpaceOnUse");
  mask.setAttribute("x", String(spec.x));
  mask.setAttribute("y", String(spec.y));
  mask.setAttribute("width", String(spec.width));
  mask.setAttribute("height", String(spec.height));
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("x", String(spec.x));
  rect.setAttribute("y", String(spec.y));
  rect.setAttribute("width", String(spec.width));
  rect.setAttribute("height", String(spec.height));
  rect.setAttribute("fill", "#ffffff");
  mask.appendChild(rect);
  ensureDefs(document).appendChild(mask);
  return serialize(document);
}

export function applySvgMask(
  source: string,
  id: string,
  targetIds: readonly string[],
): string {
  if (!SAFE_ID.test(id)) throw new Error("Mask ID is invalid");
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  const mask = findById(document, id);
  if (!mask || mask.localName !== "mask")
    throw new Error("Mask ID does not name an SVG mask");
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    if (target === mask || isDescendant(target, mask))
      throw new Error("A mask cannot mask itself or its contents");
    target.setAttribute("mask", `url(#${id})`);
  }
  return serialize(document);
}

export function releaseSvgMask(
  source: string,
  targetIds: readonly string[],
): string {
  validateTargetIds(targetIds);
  const document = parseDocument(source);
  for (const targetId of targetIds) {
    const target = findById(document, targetId);
    if (!target) throw new Error("Shape ID does not exist");
    target.removeAttribute("mask");
  }
  return serialize(document);
}

export function deleteSvgMask(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Mask ID is invalid");
  const document = parseDocument(source);
  const mask = findById(document, id);
  if (!mask || mask.localName !== "mask")
    throw new Error("Mask ID does not name an SVG mask");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element === mask || isDescendant(element, mask)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute && referencesClip(attribute.value, id))
        throw new Error("Deleting this mask would break an SVG reference");
    }
    if (
      element.localName === "style" &&
      referencesClip(element.textContent ?? "", id)
    )
      throw new Error("Deleting this mask would break an SVG reference");
  }
  mask.parentNode?.removeChild(mask);
  return serialize(document);
}

function validateClipSpec(spec: SvgClipPathSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Clip ID is invalid");
  for (const value of [spec.x, spec.y, spec.width, spec.height])
    if (!Number.isFinite(value))
      throw new Error("Clip coordinates must be finite");
  if (spec.width <= 0 || spec.height <= 0)
    throw new Error("Clip width and height must be positive");
  if (
    spec.units === "objectBoundingBox" &&
    (spec.x < 0 ||
      spec.y < 0 ||
      spec.width > 1 ||
      spec.height > 1 ||
      spec.x + spec.width > 1 ||
      spec.y + spec.height > 1)
  )
    throw new Error(
      "Object bounding box clip coordinates must be within zero and one",
    );
}

function validateMaskSpec(spec: SvgMaskSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Mask ID is invalid");
  for (const value of [spec.x, spec.y, spec.width, spec.height])
    if (!Number.isFinite(value))
      throw new Error("Mask coordinates must be finite");
  if (spec.width <= 0 || spec.height <= 0)
    throw new Error("Mask width and height must be positive");
}

function validateTargetIds(targetIds: readonly string[]): void {
  if (
    targetIds.length < 1 ||
    targetIds.length > 100 ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error("Clip target IDs must be unique and bounded");
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
    throw new Error("SVG must be sanitized before changing clip paths");
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

function isDescendant(element: XmlElement, ancestor: XmlElement): boolean {
  for (
    let parent = element.parentNode;
    parent?.nodeType === 1;
    parent = parent.parentNode
  )
    if (parent === ancestor) return true;
  return false;
}

function referencesClip(value: string, id: string): boolean {
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
