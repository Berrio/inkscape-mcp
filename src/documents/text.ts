import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
  type Text as XmlText,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const BASELINES = [
  "auto",
  "alphabetic",
  "central",
  "hanging",
  "middle",
] as const;
const DIRECTIONS = ["ltr", "rtl"] as const;
const WRITING_MODES = ["horizontal-tb", "vertical-rl", "vertical-lr"] as const;

export type SvgTextLayout = {
  baseline?: (typeof BASELINES)[number] | undefined;
  direction?: (typeof DIRECTIONS)[number] | undefined;
  letterSpacing?: number | undefined;
  textAnchor?: "start" | "middle" | "end" | undefined;
  wordSpacing?: number | undefined;
  writingMode?: (typeof WRITING_MODES)[number] | undefined;
};
export type SvgTextSpan = {
  dx?: number | undefined;
  dy?: number | undefined;
  text: string;
};
export type SvgTextPatch =
  | {
      id: string;
      layout?: SvgTextLayout | undefined;
      mode: "preserve_structure";
      segments: readonly string[];
    }
  | {
      id: string;
      layout?: SvgTextLayout | undefined;
      lineHeight?: number | undefined;
      lines: readonly (readonly SvgTextSpan[])[];
      mode: "replace_structure";
    };

export function updateSvgText(source: string, patch: SvgTextPatch): string {
  validatePatch(patch);
  const document = parseDocument(source);
  const text = findById(document, patch.id);
  if (!text || text.localName !== "text")
    throw new Error("Text ID does not name an SVG text element");
  const container = textContentContainer(text);
  if (patch.mode === "preserve_structure") {
    const textNodes = leafTextNodes(container);
    if (textNodes.length !== patch.segments.length)
      throw new Error(
        "Segment count does not match the existing text structure",
      );
    textNodes.forEach((node, index) => {
      node.data = patch.segments[index]!;
    });
  } else {
    while (container.firstChild) container.removeChild(container.firstChild);
    const lineStart = text.getAttribute("x") ?? "0";
    patch.lines.forEach((spans, lineIndex) => {
      const line = document.createElementNS(SVG_NAMESPACE, "tspan");
      line.setAttribute("x", lineStart);
      if (lineIndex > 0)
        line.setAttribute("dy", String(patch.lineHeight ?? 1.2));
      for (const span of spans) {
        const child = document.createElementNS(SVG_NAMESPACE, "tspan");
        if (span.dx !== undefined) child.setAttribute("dx", String(span.dx));
        if (span.dy !== undefined) child.setAttribute("dy", String(span.dy));
        child.textContent = span.text;
        line.appendChild(child);
      }
      container.appendChild(line);
    });
  }
  applyLayout(text, patch.layout);
  return new XMLSerializer().serializeToString(document);
}

function validatePatch(patch: SvgTextPatch): void {
  if (!SAFE_ID.test(patch.id)) throw new Error("Text ID is invalid");
  validateLayout(patch.layout);
  if (patch.mode === "preserve_structure") {
    if (patch.segments.length < 1 || patch.segments.length > 500)
      throw new Error("Text requires between one and 500 segments");
    patch.segments.forEach(validateText);
    return;
  }
  if (patch.lines.length < 1 || patch.lines.length > 200)
    throw new Error("Text requires between one and 200 lines");
  if (
    patch.lineHeight !== undefined &&
    (!Number.isFinite(patch.lineHeight) || patch.lineHeight <= 0)
  )
    throw new Error("Line height must be finite and positive");
  for (const line of patch.lines) {
    if (line.length < 1 || line.length > 100)
      throw new Error("Each text line requires between one and 100 spans");
    for (const span of line) {
      validateText(span.text);
      if (
        ![span.dx, span.dy].every(
          (value) => value === undefined || Number.isFinite(value),
        )
      )
        throw new Error("Text span offsets must be finite");
    }
  }
}

function validateText(value: string): void {
  if (
    value.length > 10_000 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
    throw new Error("Text content is invalid");
}

function validateLayout(layout: SvgTextLayout | undefined): void {
  if (layout === undefined) return;
  if (layout.baseline !== undefined && !BASELINES.includes(layout.baseline))
    throw new Error("Text baseline is invalid");
  if (layout.direction !== undefined && !DIRECTIONS.includes(layout.direction))
    throw new Error("Text direction is invalid");
  if (
    layout.writingMode !== undefined &&
    !WRITING_MODES.includes(layout.writingMode)
  )
    throw new Error("Text writing mode is invalid");
  if (
    layout.letterSpacing !== undefined &&
    !Number.isFinite(layout.letterSpacing)
  )
    throw new Error("Letter spacing must be finite");
  if (layout.wordSpacing !== undefined && !Number.isFinite(layout.wordSpacing))
    throw new Error("Word spacing must be finite");
}

function applyLayout(
  text: XmlElement,
  layout: SvgTextLayout | undefined,
): void {
  if (layout === undefined) return;
  if (layout.baseline !== undefined)
    text.setAttribute("dominant-baseline", layout.baseline);
  if (layout.direction !== undefined)
    text.setAttribute("direction", layout.direction);
  if (layout.letterSpacing !== undefined)
    text.setAttribute("letter-spacing", String(layout.letterSpacing));
  if (layout.textAnchor !== undefined)
    text.setAttribute("text-anchor", layout.textAnchor);
  if (layout.wordSpacing !== undefined)
    text.setAttribute("word-spacing", String(layout.wordSpacing));
  if (layout.writingMode !== undefined)
    text.setAttribute("writing-mode", layout.writingMode);
}

function textContentContainer(text: XmlElement): XmlElement {
  const textPath = Array.from(text.childNodes).find(
    (node): node is XmlElement =>
      node.nodeType === 1 && (node as XmlElement).localName === "textPath",
  );
  return textPath ?? text;
}

function leafTextNodes(element: XmlElement): XmlText[] {
  const result: XmlText[] = [];
  const walk = (node: XmlNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) result.push(child as XmlText);
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(element);
  return result;
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing text");
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
