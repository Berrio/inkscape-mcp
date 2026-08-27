import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type DocumentMetadataPatch = {
  description?: string | undefined;
  license?: string | undefined;
  title?: string | undefined;
};
export type ElementAccessibilityPatch = {
  description?: string | undefined;
  hidden?: boolean | undefined;
  id: string;
  label?: string | undefined;
  title?: string | undefined;
};

export function updateSvgDocumentMetadata(
  source: string,
  patch: DocumentMetadataPatch,
): string {
  if (
    patch.title === undefined &&
    patch.description === undefined &&
    patch.license === undefined
  )
    throw new Error("Metadata requires at least one patch");
  const document = parseDocument(source);
  const root = document.documentElement!;
  if (patch.title !== undefined)
    setRootText(document, root, "title", patch.title);
  if (patch.description !== undefined)
    setRootText(document, root, "desc", patch.description);
  if (patch.license !== undefined) {
    const metadata = ensureChild(document, root, "metadata");
    setChildText(document, metadata, "license", patch.license);
  }
  return serialize(document);
}

export function updateSvgElementAccessibility(
  source: string,
  patches: readonly ElementAccessibilityPatch[],
): string {
  if (patches.length < 1 || patches.length > 100)
    throw new Error("Accessibility requires between one and 100 elements");
  if (new Set(patches.map((patch) => patch.id)).size !== patches.length)
    throw new Error("Accessibility IDs must be unique");
  const document = parseDocument(source);
  for (const patch of patches) {
    if (!SAFE_ID.test(patch.id)) throw new Error("Shape ID is invalid");
    if (
      patch.label === undefined &&
      patch.title === undefined &&
      patch.description === undefined &&
      patch.hidden === undefined
    )
      throw new Error("Accessibility element requires at least one patch");
    const element = findById(document, patch.id);
    if (!element) throw new Error("Shape ID does not exist");
    if (patch.label !== undefined) {
      validateText(patch.label, "Accessibility label");
      element.setAttribute("aria-label", patch.label);
      element.removeAttribute("aria-labelledby");
    }
    if (patch.hidden !== undefined)
      element.setAttribute("aria-hidden", String(patch.hidden));
    if (patch.title !== undefined)
      setChildText(document, element, "title", patch.title);
    if (patch.description !== undefined)
      setChildText(document, element, "desc", patch.description);
  }
  return serialize(document);
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing metadata");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function setRootText(
  document: XmlDocument,
  root: XmlElement,
  name: "desc" | "title",
  value: string,
): void {
  const element = ensureChild(document, root, name);
  setText(element, value, name);
  root.insertBefore(element, firstGraphicChild(root));
}

function setChildText(
  document: XmlDocument,
  parent: XmlElement,
  name: "desc" | "license" | "title",
  value: string,
): void {
  const element = ensureChild(document, parent, name);
  setText(element, value, name);
}

function ensureChild(
  document: XmlDocument,
  parent: XmlElement,
  name: "desc" | "license" | "metadata" | "title",
): XmlElement {
  const existing = Array.from(parent.childNodes).find(
    (node): node is XmlElement =>
      node.nodeType === 1 && (node as XmlElement).localName === name,
  );
  if (existing) return existing;
  const child = document.createElementNS(SVG_NAMESPACE, name);
  parent.appendChild(child);
  return child;
}

function firstGraphicChild(root: XmlElement): XmlElement | null {
  return (
    (Array.from(root.childNodes).find(
      (node) =>
        node.nodeType === 1 &&
        !["defs", "desc", "metadata", "style", "title"].includes(
          (node as XmlElement).localName ?? "",
        ),
    ) as XmlElement | undefined) ?? null
  );
}

function setText(element: XmlElement, value: string, kind: string): void {
  validateText(value, kind);
  element.textContent = value;
}

function validateText(value: string, kind: string): void {
  if (
    value.length < 1 ||
    value.length > 2_000 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new Error(`${kind} is invalid`);
}

function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
