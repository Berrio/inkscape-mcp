import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const STYLE_ATTRIBUTES = [
  "fill",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "opacity",
  "stroke",
  "text-anchor",
] as const;

export type FlowedTextInspection = {
  flowedTexts: readonly { id?: string | undefined; paragraphs: number }[];
};

/** Lists non-standard Inkscape flowed text without interpreting layout. */
export function inspectSvgFlowedText(source: string): FlowedTextInspection {
  const document = parseSafeDocument(source);
  return {
    flowedTexts: Array.from(document.getElementsByTagName("*"))
      .filter((element) => element.localName === "flowRoot")
      .map((element) => ({
        ...(element.getAttribute("id") === null
          ? {}
          : { id: element.getAttribute("id")! }),
        paragraphs: descendants(element, "flowPara").length,
      })),
  };
}

/** Converts a strictly simple flowRoot to editable SVG text after explicit confirmation. */
export function convertSimpleSvgFlowedText(
  source: string,
  id: string,
): { id: string; svg: string; warning: "FLOWED_TEXT_LAYOUT_LOST" } {
  if (!SAFE_ID.test(id)) throw new Error("Flowed text ID is invalid");
  const document = parseSafeDocument(source);
  const flow = Array.from(document.getElementsByTagName("*")).find(
    (element) =>
      element.localName === "flowRoot" && element.getAttribute("id") === id,
  );
  if (!flow) throw new Error("Flowed text ID does not exist");
  const region = directChildren(flow, "flowRegion");
  const paragraphs = directChildren(flow, "flowPara");
  const rects = region.length === 1 ? descendants(region[0]!, "rect") : [];
  if (region.length !== 1 || rects.length !== 1 || paragraphs.length < 1)
    throw new Error("Only one-region simple flowed text can be converted");
  if (
    Array.from(flow.childNodes).some(
      (node) =>
        node.nodeType === node.ELEMENT_NODE &&
        node !== region[0] &&
        !paragraphs.includes(node as XmlElement),
    )
  )
    throw new Error("Flowed text structure is not supported for conversion");
  const rect = rects[0]!;
  const x = finiteAttribute(rect, "x", 0);
  const y = finiteAttribute(rect, "y", 0);
  const fontSize = finiteAttribute(flow, "font-size", 16);
  const text = document.createElementNS(SVG_NAMESPACE, "text");
  text.setAttribute("id", id);
  for (const name of STYLE_ATTRIBUTES) {
    const value = flow.getAttribute(name);
    if (value !== null) text.setAttribute(name, value);
  }
  paragraphs.forEach((paragraph, index) => {
    const span = document.createElementNS(SVG_NAMESPACE, "tspan");
    span.setAttribute("x", String(x));
    span.setAttribute("y", String(y + fontSize * (index + 1) * 1.2));
    span.appendChild(
      document.createTextNode((paragraph.textContent ?? "").trim()),
    );
    text.appendChild(span);
  });
  const parent = flow.parentNode;
  if (!parent) throw new Error("Flowed text parent is missing");
  parent.replaceChild(text, flow);
  return {
    id,
    svg: new XMLSerializer().serializeToString(document),
    warning: "FLOWED_TEXT_LAYOUT_LOST",
  };
}

function parseSafeDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before handling flowed text");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function descendants(element: XmlElement, localName: string): XmlElement[] {
  return Array.from(element.getElementsByTagName("*")).filter(
    (child) => child.localName === localName,
  );
}

function directChildren(element: XmlElement, localName: string): XmlElement[] {
  return Array.from(element.childNodes).filter(
    (child): child is XmlElement =>
      child.nodeType === child.ELEMENT_NODE && child.localName === localName,
  );
}

function finiteAttribute(
  element: XmlElement,
  name: string,
  fallback: number,
): number {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`Flowed text ${name} must be a finite user-unit number`);
  return value;
}
