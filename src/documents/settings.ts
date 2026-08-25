import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const SODIPODI_NAMESPACE = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const COLOR = /^#[a-fA-F0-9]{6}$/u;

export type DocumentDisplaySettings = {
  borderColor: string;
  borderOpacity: number;
  deskColor: string;
  pageColor: string;
  pageOpacity: number;
};
export type DocumentDisplaySettingsPatch = {
  borderColor?: string | undefined;
  borderOpacity?: number | undefined;
  deskColor?: string | undefined;
  pageColor?: string | undefined;
  pageOpacity?: number | undefined;
};

export function inspectDocumentDisplaySettings(
  source: string,
): DocumentDisplaySettings {
  const namedView = findNamedView(parseDocument(source));
  return {
    borderColor: readColor(namedView, "bordercolor", "#666666"),
    borderOpacity: readOpacity(namedView, "borderopacity", 1),
    deskColor: readColorNs(namedView, "deskcolor", "#d1d1d1"),
    pageColor: readColor(namedView, "pagecolor", "#ffffff"),
    pageOpacity: readOpacityNs(namedView, "pageopacity", 0),
  };
}

export function updateDocumentDisplaySettings(
  source: string,
  patch: DocumentDisplaySettingsPatch,
): { settings: DocumentDisplaySettings; svg: string } {
  const document = parseDocument(source);
  const namedView = findOrCreateNamedView(document);
  if (patch.pageColor !== undefined)
    namedView.setAttribute("pagecolor", validateColor(patch.pageColor));
  if (patch.borderColor !== undefined)
    namedView.setAttribute("bordercolor", validateColor(patch.borderColor));
  if (patch.deskColor !== undefined)
    namedView.setAttributeNS(
      INKSCAPE_NAMESPACE,
      "inkscape:deskcolor",
      validateColor(patch.deskColor),
    );
  if (patch.pageOpacity !== undefined)
    namedView.setAttributeNS(
      INKSCAPE_NAMESPACE,
      "inkscape:pageopacity",
      formatOpacity(patch.pageOpacity),
    );
  if (patch.borderOpacity !== undefined)
    namedView.setAttribute("borderopacity", formatOpacity(patch.borderOpacity));
  const svg = new XMLSerializer().serializeToString(document);
  return { settings: inspectDocumentDisplaySettings(svg), svg };
}

function parseDocument(source: string): XmlDocument {
  const checked = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (checked.removed.length > 0)
    throw new Error("SVG must be sanitized before changing document settings");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}
function findNamedView(document: XmlDocument): XmlElement | undefined {
  return document.getElementsByTagNameNS(SODIPODI_NAMESPACE, "namedview")[0];
}
function findOrCreateNamedView(document: XmlDocument): XmlElement {
  const existing = findNamedView(document);
  if (existing) return existing;
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
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
function readColor(
  element: XmlElement | undefined,
  name: string,
  fallback: string,
): string {
  return element
    ? validateColor(element.getAttribute(name) ?? fallback)
    : fallback;
}
function readColorNs(
  element: XmlElement | undefined,
  name: string,
  fallback: string,
): string {
  return element
    ? validateColor(
        element.getAttributeNS(INKSCAPE_NAMESPACE, name) ?? fallback,
      )
    : fallback;
}
function readOpacity(
  element: XmlElement | undefined,
  name: string,
  fallback: number,
): number {
  return element
    ? validateOpacity(element.getAttribute(name) ?? String(fallback))
    : fallback;
}
function readOpacityNs(
  element: XmlElement | undefined,
  name: string,
  fallback: number,
): number {
  return element
    ? validateOpacity(
        element.getAttributeNS(INKSCAPE_NAMESPACE, name) ?? String(fallback),
      )
    : fallback;
}
function validateColor(value: string): string {
  if (!COLOR.test(value)) throw new Error("Color must be #rrggbb");
  return value.toLowerCase();
}
function validateOpacity(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error("Opacity must be between zero and one");
  return value;
}
function formatOpacity(value: number): string {
  return String(validateOpacity(String(value)));
}
