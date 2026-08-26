import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type ShapeStyle = {
  fill?: string | undefined;
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  fontWeight?: "bold" | "normal" | undefined;
  opacity?: number | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  textAnchor?: "end" | "middle" | "start" | undefined;
};
type ShapeBase = {
  id?: string | undefined;
  parentId?: string | undefined;
  style?: ShapeStyle | undefined;
};
export type ShapeSpec =
  | (ShapeBase & {
      height: number;
      kind: "rect";
      rx?: number | undefined;
      ry?: number | undefined;
      width: number;
      x: number;
      y: number;
    })
  | (ShapeBase & { cx: number; cy: number; kind: "circle"; r: number })
  | (ShapeBase & {
      cx: number;
      cy: number;
      kind: "ellipse";
      rx: number;
      ry: number;
    })
  | (ShapeBase & {
      kind: "line";
      x1: number;
      x2: number;
      y1: number;
      y2: number;
    })
  | (ShapeBase & {
      kind: "polygon" | "polyline";
      points: readonly { x: number; y: number }[];
    })
  | (ShapeBase & {
      kind: "text";
      text: string;
      x: number;
      y: number;
    })
  | (ShapeBase & {
      kind: "group" | "layer";
      label?: string | undefined;
    });

const COLOR = /^#[a-fA-F0-9]{6}$/u;
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export function createSvgShapes(
  source: string,
  shapes: readonly ShapeSpec[],
): { ids: readonly string[]; svg: string } {
  if (shapes.length < 1 || shapes.length > 100)
    throw new Error("Shape batch must contain between one and 100 shapes");
  const document = parseSafeDocument(source);
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  const usedIds = new Set(
    Array.from(document.getElementsByTagName("*")).flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [id];
    }),
  );
  const ids: string[] = [];
  for (const shape of shapes) {
    const id = shape.id ?? `shape_${crypto.randomUUID().replaceAll("-", "")}`;
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    if (usedIds.has(id)) throw new Error("Shape ID already exists");
    usedIds.add(id);
    const element = createShapeElement(document, shape);
    element.setAttribute("id", id);
    applyStyle(element, shape.style);
    resolveParent(document, root, shape.parentId).appendChild(element);
    ids.push(id);
  }
  return { ids, svg: new XMLSerializer().serializeToString(document) };
}

export function deleteSvgShapes(
  source: string,
  ids: readonly string[],
): { deletedIds: readonly string[]; svg: string } {
  if (ids.length < 1 || ids.length > 100)
    throw new Error("Deletion batch must contain between one and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Deletion IDs must be unique");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const targets = ids.map((id) => {
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    const target = elements.find(
      (element) => element.getAttribute("id") === id,
    );
    if (!target) throw new Error("Shape ID does not exist");
    return target;
  });
  const targetSet = new Set(targets);
  for (const element of elements) {
    if (isWithinDeletedTree(element, targetSet)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      if (
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        attribute.value.trim().startsWith("#") &&
        ids.includes(attribute.value.trim().slice(1))
      )
        throw new Error("Deleting this shape would break an SVG reference");
    }
  }
  for (const target of targets) target.parentNode?.removeChild(target);
  return {
    deletedIds: [...ids],
    svg: new XMLSerializer().serializeToString(document),
  };
}

function parseSafeDocument(source: string): XmlDocument {
  const sanitization = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitization.removed.length > 0)
    throw new Error("SVG must be sanitized before creating shapes");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}
function createShapeElement(
  document: XmlDocument,
  shape: ShapeSpec,
): XmlElement {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    shape.kind === "layer" ? "g" : shape.kind,
  );
  switch (shape.kind) {
    case "rect":
      setFinite(element, "x", shape.x);
      setFinite(element, "y", shape.y);
      setPositive(element, "width", shape.width);
      setPositive(element, "height", shape.height);
      setOptionalNonNegative(element, "rx", shape.rx);
      setOptionalNonNegative(element, "ry", shape.ry);
      break;
    case "circle":
      setFinite(element, "cx", shape.cx);
      setFinite(element, "cy", shape.cy);
      setPositive(element, "r", shape.r);
      break;
    case "ellipse":
      setFinite(element, "cx", shape.cx);
      setFinite(element, "cy", shape.cy);
      setPositive(element, "rx", shape.rx);
      setPositive(element, "ry", shape.ry);
      break;
    case "line":
      setFinite(element, "x1", shape.x1);
      setFinite(element, "y1", shape.y1);
      setFinite(element, "x2", shape.x2);
      setFinite(element, "y2", shape.y2);
      break;
    case "polygon":
    case "polyline":
      if (shape.points.length < 2 || shape.points.length > 1_000)
        throw new Error(
          "Polyline or polygon needs between two and 1000 points",
        );
      element.setAttribute(
        "points",
        shape.points
          .map((point) => {
            assertFinite(point.x, "point x");
            assertFinite(point.y, "point y");
            return `${point.x},${point.y}`;
          })
          .join(" "),
      );
      break;
    case "text":
      if (shape.text.length > 10_000 || hasControlCharacters(shape.text))
        throw new Error("Text content is invalid or too long");
      setFinite(element, "x", shape.x);
      setFinite(element, "y", shape.y);
      element.textContent = shape.text;
      break;
    case "group":
      break;
    case "layer":
      element.setAttributeNS(
        "http://www.inkscape.org/namespaces/inkscape",
        "inkscape:groupmode",
        "layer",
      );
      element.setAttributeNS(
        "http://www.inkscape.org/namespaces/inkscape",
        "inkscape:label",
        shape.label ?? shape.id ?? "Layer",
      );
      break;
  }
  return element;
}
function resolveParent(
  document: XmlDocument,
  root: XmlElement,
  parentId: string | undefined,
): XmlElement {
  if (parentId === undefined) return root;
  const parent = Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === parentId,
  );
  if (!parent || parent.localName !== "g")
    throw new Error("Shape parent must be an existing group or layer");
  return parent;
}
function isWithinDeletedTree(
  element: XmlElement,
  deleted: ReadonlySet<XmlElement>,
): boolean {
  let current: XmlElement | null = element;
  while (current) {
    if (deleted.has(current)) return true;
    current =
      current.parentNode?.nodeType === 1
        ? (current.parentNode as XmlElement)
        : null;
  }
  return false;
}
function applyStyle(element: XmlElement, style: ShapeStyle | undefined): void {
  if (!style) return;
  if (style.fill !== undefined) element.setAttribute("fill", color(style.fill));
  if (style.fontFamily !== undefined) {
    if (
      style.fontFamily.length < 1 ||
      style.fontFamily.length > 256 ||
      hasControlCharacters(style.fontFamily)
    )
      throw new Error("fontFamily is invalid");
    element.setAttribute("font-family", style.fontFamily);
  }
  if (style.fontSize !== undefined) {
    assertRange(style.fontSize, "fontSize", Number.MIN_VALUE, 10_000);
    element.setAttribute("font-size", String(style.fontSize));
  }
  if (style.fontWeight !== undefined)
    element.setAttribute("font-weight", style.fontWeight);
  if (style.stroke !== undefined)
    element.setAttribute("stroke", color(style.stroke));
  if (style.opacity !== undefined) {
    assertRange(style.opacity, "opacity", 0, 1);
    element.setAttribute("opacity", String(style.opacity));
  }
  if (style.strokeWidth !== undefined) {
    assertRange(style.strokeWidth, "strokeWidth", 0, Number.POSITIVE_INFINITY);
    element.setAttribute("stroke-width", String(style.strokeWidth));
  }
  if (style.textAnchor !== undefined)
    element.setAttribute("text-anchor", style.textAnchor);
}
function setFinite(element: XmlElement, name: string, value: number): void {
  assertFinite(value, name);
  element.setAttribute(name, String(value));
}
function setPositive(element: XmlElement, name: string, value: number): void {
  assertRange(value, name, Number.MIN_VALUE, Number.POSITIVE_INFINITY);
  element.setAttribute(name, String(value));
}
function setOptionalNonNegative(
  element: XmlElement,
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  assertRange(value, name, 0, Number.POSITIVE_INFINITY);
  element.setAttribute(name, String(value));
}
function color(value: string): string {
  if (!COLOR.test(value)) throw new Error("Shape colors must be #rrggbb");
  return value.toLowerCase();
}
function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
function assertRange(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  assertFinite(value, name);
  if (value < minimum || value > maximum)
    throw new Error(`${name} is out of range`);
}
function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}
