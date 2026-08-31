import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const SODIPODI_NAMESPACE = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The only multipage representation currently covered by real MCP smoke tests. */
export const PAGES_V14_ADAPTER = "pages_v14" as const;

export type SvgPage = {
  height: number;
  id: string;
  label?: string;
  width: number;
  x: number;
  y: number;
};
export type NewSvgPage = {
  height: number;
  id?: string | undefined;
  label?: string | undefined;
  width: number;
  x: number;
  y: number;
};
export type SvgPagePatch = {
  height?: number | undefined;
  label?: string | undefined;
  width?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
};
export type PageObjectBounds = {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
};
export type SvgPageLayoutValidation = {
  emptyPageIds: readonly string[];
  outsideObjectIds: readonly string[];
  overlaps: readonly {
    area: { height: number; width: number; x: number; y: number };
    pageIds: readonly [string, string];
  }[];
};

export function listSvgPages(source: string): readonly SvgPage[] {
  return pageElements(parseReadDocument(source)).map(readPage);
}

/** Validates explicit page rectangles against visual object bounds supplied by a trusted adapter. */
export function validateSvgPageLayout(
  pages: readonly SvgPage[],
  objects: readonly PageObjectBounds[],
): SvgPageLayoutValidation {
  const overlaps: {
    area: { height: number; width: number; x: number; y: number };
    pageIds: [string, string];
  }[] = [];
  for (let left = 0; left < pages.length; left += 1)
    for (let right = left + 1; right < pages.length; right += 1) {
      const first = pages[left]!;
      const second = pages[right]!;
      const area = intersection(first, second);
      if (area) overlaps.push({ area, pageIds: [first.id, second.id] });
    }
  return {
    emptyPageIds: pages
      .filter((page) => !objects.some((object) => intersection(page, object)))
      .map((page) => page.id),
    outsideObjectIds: objects
      .filter((object) => !pages.some((page) => intersection(page, object)))
      .map((object) => object.id)
      .sort(),
    overlaps,
  };
}

export function addSvgPage(
  source: string,
  page: NewSvgPage,
): { page: SvgPage; svg: string } {
  const document = parseDocument(source);
  const root = requireRoot(document);
  const namedView = getOrCreateNamedView(document, root);
  const element = document.createElementNS(INKSCAPE_NAMESPACE, "inkscape:page");
  element.setAttribute("id", page.id ?? `page_${crypto.randomUUID()}`);
  writePage(element, page);
  namedView.appendChild(element);
  return { page: readPage(element), svg: serialize(document) };
}

export function updateSvgPage(
  source: string,
  id: string,
  patch: SvgPagePatch,
): { page: SvgPage; svg: string } {
  const document = parseDocument(source);
  const element = findPage(document, id);
  writePage(element, patch);
  return { page: readPage(element), svg: serialize(document) };
}

export function deleteSvgPage(source: string, id: string): string {
  const document = parseDocument(source);
  const element = findPage(document, id);
  element.parentNode?.removeChild(element);
  return serialize(document);
}

export function reorderSvgPages(
  source: string,
  ids: readonly string[],
): string {
  const document = parseDocument(source);
  const pages = pageElements(document);
  const known = new Map(pages.map((page) => [readPage(page).id, page]));
  if (ids.length !== pages.length || new Set(ids).size !== ids.length)
    throw new Error("Page order must contain every page exactly once");
  const ordered = ids.map((id) => {
    const page = known.get(id);
    if (!page) throw new Error("Page order references an unknown page");
    return page;
  });
  const parent = pages[0]?.parentNode;
  if (!parent) throw new Error("Document has no explicit Inkscape pages");
  for (const page of ordered) parent.appendChild(page);
  return serialize(document);
}

function parseDocument(source: string): XmlDocument {
  const checked = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (checked.removed.length > 0)
    throw new Error("SVG must be sanitized before changing its pages");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  requireRoot(document);
  assertSupportedPageRepresentation(document);
  return document;
}

/**
 * Page enumeration is a read-only operation. Parse the sanitized copy so an
 * unsafe external reference cannot make inspection fail or reach the XML DOM.
 * Page mutations continue to use parseDocument and reject altered input.
 */
function parseReadDocument(source: string): XmlDocument {
  const checked = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(
    checked.svg,
    "image/svg+xml",
  );
  requireRoot(document);
  assertSupportedPageRepresentation(document);
  return document;
}

function pageElements(document: XmlDocument): XmlElement[] {
  assertSupportedPageRepresentation(document);
  return Array.from(
    document.getElementsByTagNameNS(INKSCAPE_NAMESPACE, "page"),
  );
}

function assertSupportedPageRepresentation(document: XmlDocument): void {
  if (document.getElementsByTagNameNS(SVG_NAMESPACE, "view").length > 0)
    throw new Error(
      "PAGES_V15_UNSUPPORTED: svg:view requires the pages_v15 adapter",
    );
}
function findPage(document: XmlDocument, id: string): XmlElement {
  const page = pageElements(document).find(
    (candidate) => candidate.getAttribute("id") === id,
  );
  if (!page) throw new Error("Page does not exist");
  return page;
}
function readPage(element: XmlElement): SvgPage {
  const id = element.getAttribute("id");
  if (!id) throw new Error("Inkscape page is missing an id");
  const width = readPositiveAttribute(element, "width");
  const height = readPositiveAttribute(element, "height");
  const x = readFiniteAttribute(element, "x", 0);
  const y = readFiniteAttribute(element, "y", 0);
  const label =
    element.getAttributeNS(INKSCAPE_NAMESPACE, "label") ?? undefined;
  return { height, id, ...(label === undefined ? {} : { label }), width, x, y };
}
function writePage(element: XmlElement, page: NewSvgPage | SvgPagePatch): void {
  for (const name of ["x", "y", "width", "height"] as const) {
    const value = page[name];
    if (value === undefined) continue;
    if (
      !Number.isFinite(value) ||
      ((name === "width" || name === "height") && value <= 0)
    )
      throw new Error(
        `Page ${name} must be finite${name === "width" || name === "height" ? " and positive" : ""}`,
      );
    element.setAttribute(name, String(value));
  }
  if ("label" in page && page.label !== undefined)
    element.setAttributeNS(INKSCAPE_NAMESPACE, "inkscape:label", page.label);
}
function getOrCreateNamedView(
  document: XmlDocument,
  root: XmlElement,
): XmlElement {
  const current = document.getElementsByTagNameNS(
    SODIPODI_NAMESPACE,
    "namedview",
  )[0];
  if (current) return current;
  root.setAttribute("xmlns:inkscape", INKSCAPE_NAMESPACE);
  root.setAttribute("xmlns:sodipodi", SODIPODI_NAMESPACE);
  const namedView = document.createElementNS(
    SODIPODI_NAMESPACE,
    "sodipodi:namedview",
  );
  namedView.setAttribute("id", "namedview1");
  root.insertBefore(namedView, root.firstChild);
  return namedView;
}
function readFiniteAttribute(
  element: XmlElement,
  name: string,
  fallback?: number,
): number {
  const raw = element.getAttribute(name);
  if (raw === null && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Page ${name} must be finite`);
  return value;
}
function readPositiveAttribute(element: XmlElement, name: string): number {
  const value = readFiniteAttribute(element, name);
  if (value <= 0) throw new Error(`Page ${name} must be positive`);
  return value;
}
function requireRoot(document: XmlDocument): XmlElement {
  const root = document.documentElement;
  if (!root || root.localName !== "svg") throw new Error("SVG root is missing");
  return root;
}
function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}

function intersection(
  first: { height: number; width: number; x: number; y: number },
  second: { height: number; width: number; x: number; y: number },
): { height: number; width: number; x: number; y: number } | undefined {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > left && bottom > top
    ? { height: bottom - top, width: right - left, x: left, y: top }
    : undefined;
}
