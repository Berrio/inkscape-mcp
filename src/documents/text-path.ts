import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export function attachSvgTextToPath(
  source: string,
  textId: string,
  pathId: string,
  startOffset?: number,
): string {
  if (!SAFE_ID.test(textId) || !SAFE_ID.test(pathId))
    throw new Error("Text and path IDs are invalid");
  if (startOffset !== undefined && !Number.isFinite(startOffset))
    throw new Error("Text path startOffset must be finite");
  const document = parseDocument(source);
  const text = findById(document, textId);
  const path = findById(document, pathId);
  if (!text || text.localName !== "text")
    throw new Error("Text ID does not name an SVG text element");
  if (!path || path.localName !== "path")
    throw new Error("Path ID does not name an SVG path");
  if (
    Array.from(text.childNodes).some(
      (node) =>
        node.nodeType === 1 && (node as XmlElement).localName === "textPath",
    )
  )
    throw new Error("Text element already has a textPath");
  const textPath = document.createElementNS(SVG_NAMESPACE, "textPath");
  textPath.setAttribute("href", `#${pathId}`);
  if (startOffset !== undefined)
    textPath.setAttribute("startOffset", String(startOffset));
  while (text.firstChild) textPath.appendChild(text.firstChild);
  text.appendChild(textPath);
  return serialize(document);
}

export function detachSvgTextFromPath(source: string, textId: string): string {
  if (!SAFE_ID.test(textId)) throw new Error("Text ID is invalid");
  const document = parseDocument(source);
  const text = findById(document, textId);
  if (!text || text.localName !== "text")
    throw new Error("Text ID does not name an SVG text element");
  const textPath = Array.from(text.childNodes).find(
    (node): node is XmlElement =>
      node.nodeType === 1 && (node as XmlElement).localName === "textPath",
  );
  if (!textPath) throw new Error("Text element has no textPath");
  while (textPath.firstChild) text.insertBefore(textPath.firstChild, textPath);
  text.removeChild(textPath);
  return serialize(document);
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing text paths");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
