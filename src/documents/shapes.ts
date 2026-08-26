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
export type ElementTransform =
  | {
      angle: number;
      cx?: number | undefined;
      cy?: number | undefined;
      kind: "rotate";
    }
  | { kind: "scale"; x: number; y?: number | undefined }
  | { kind: "translate"; x: number; y: number }
  | { angle: number; kind: "skew_x" | "skew_y" }
  | { kind: "flip_x" | "flip_y" }
  | {
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
      kind: "matrix";
    };
export type ElementGeometryPatch =
  | {
      height?: number | undefined;
      kind: "rect";
      rx?: number | undefined;
      ry?: number | undefined;
      width?: number | undefined;
      x?: number | undefined;
      y?: number | undefined;
    }
  | {
      cx?: number | undefined;
      cy?: number | undefined;
      kind: "circle";
      r?: number | undefined;
    }
  | {
      cx?: number | undefined;
      cy?: number | undefined;
      kind: "ellipse";
      rx?: number | undefined;
      ry?: number | undefined;
    }
  | {
      kind: "line";
      x1?: number | undefined;
      x2?: number | undefined;
      y1?: number | undefined;
      y2?: number | undefined;
    }
  | {
      kind: "polygon" | "polyline";
      points?: readonly { x: number; y: number }[] | undefined;
    }
  | { kind: "text"; x?: number | undefined; y?: number | undefined };
export type ElementUpdate = {
  geometry?: ElementGeometryPatch | undefined;
  id: string;
  label?: string | undefined;
  style?: ShapeStyle | undefined;
  text?: string | undefined;
};
export type ElementArrangeAction = "back" | "front" | "lower" | "raise";
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

export function transformSvgShapes(
  source: string,
  ids: readonly string[],
  transform: ElementTransform,
): { ids: readonly string[]; svg: string } {
  if (ids.length < 1 || ids.length > 100)
    throw new Error("Transform batch must contain between one and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Transform IDs must be unique");
  const document = parseSafeDocument(source);
  const transformValue = serializeTransform(transform);
  for (const id of ids) {
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    const element = Array.from(document.getElementsByTagName("*")).find(
      (candidate) => candidate.getAttribute("id") === id,
    );
    if (!element) throw new Error("Shape ID does not exist");
    const existing = element.getAttribute("transform");
    element.setAttribute(
      "transform",
      existing ? `${existing} ${transformValue}` : transformValue,
    );
  }
  return {
    ids: [...ids],
    svg: new XMLSerializer().serializeToString(document),
  };
}

export function updateSvgShapes(
  source: string,
  updates: readonly ElementUpdate[],
): { ids: readonly string[]; svg: string } {
  if (updates.length < 1 || updates.length > 100)
    throw new Error("Update batch must contain between one and 100 elements");
  if (new Set(updates.map((update) => update.id)).size !== updates.length)
    throw new Error("Update IDs must be unique");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  for (const update of updates) {
    if (!SAFE_ID.test(update.id)) throw new Error("Shape ID is invalid");
    if (
      update.geometry === undefined &&
      update.label === undefined &&
      update.style === undefined &&
      update.text === undefined
    )
      throw new Error("Element update requires at least one patch");
    const element = elements.find(
      (candidate) => candidate.getAttribute("id") === update.id,
    );
    if (!element) throw new Error("Shape ID does not exist");
    if (update.geometry !== undefined)
      applyGeometryPatch(element, update.geometry);
    if (update.style !== undefined) applyStyle(element, update.style);
    if (update.text !== undefined) {
      if (element.localName !== "text")
        throw new Error("Text content can only update a text element");
      validateText(update.text);
      element.textContent = update.text;
    }
    if (update.label !== undefined) {
      if (!isLayer(element)) throw new Error("Label can only update a layer");
      if (
        update.label.length < 1 ||
        update.label.length > 256 ||
        hasControlCharacters(update.label)
      )
        throw new Error("Layer label is invalid");
      element.setAttributeNS(
        "http://www.inkscape.org/namespaces/inkscape",
        "inkscape:label",
        update.label,
      );
    }
  }
  return {
    ids: updates.map((update) => update.id),
    svg: new XMLSerializer().serializeToString(document),
  };
}

export function arrangeSvgShapes(
  source: string,
  ids: readonly string[],
  action: ElementArrangeAction,
): { ids: readonly string[]; svg: string } {
  if (ids.length < 1 || ids.length > 100)
    throw new Error("Arrange batch must contain between one and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Arrange IDs must be unique");
  if ((action === "raise" || action === "lower") && ids.length !== 1)
    throw new Error("Raise and lower require exactly one ID");
  const document = parseSafeDocument(source);
  const targets = ids.map((id) => {
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    const target = Array.from(document.getElementsByTagName("*")).find(
      (candidate) => candidate.getAttribute("id") === id,
    );
    if (!target) throw new Error("Shape ID does not exist");
    return target;
  });
  const parent = parentElement(targets[0]!);
  if (!parent || targets.some((target) => parentElement(target) !== parent))
    throw new Error("Arrange targets must share the same parent");
  const ordered = childElements(parent).filter((element) =>
    targets.includes(element),
  );
  switch (action) {
    case "front":
      for (const target of ordered) parent.appendChild(target);
      break;
    case "back":
      for (const target of ordered.toReversed())
        parent.insertBefore(target, parent.firstChild);
      break;
    case "raise": {
      const target = targets[0]!;
      const next = nextElementSibling(target);
      if (next) parent.insertBefore(target, next.nextSibling);
      break;
    }
    case "lower": {
      const target = targets[0]!;
      const previous = previousElementSibling(target);
      if (previous) parent.insertBefore(target, previous);
      break;
    }
  }
  return {
    ids: [...ids],
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
      validateText(shape.text);
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
function applyGeometryPatch(
  element: XmlElement,
  patch: ElementGeometryPatch,
): void {
  if (element.localName !== patch.kind)
    throw new Error("Geometry patch kind does not match the element");
  switch (patch.kind) {
    case "rect":
      setOptionalFinite(element, "x", patch.x);
      setOptionalFinite(element, "y", patch.y);
      setOptionalPositive(element, "width", patch.width);
      setOptionalPositive(element, "height", patch.height);
      setOptionalNonNegative(element, "rx", patch.rx);
      setOptionalNonNegative(element, "ry", patch.ry);
      break;
    case "circle":
      setOptionalFinite(element, "cx", patch.cx);
      setOptionalFinite(element, "cy", patch.cy);
      setOptionalPositive(element, "r", patch.r);
      break;
    case "ellipse":
      setOptionalFinite(element, "cx", patch.cx);
      setOptionalFinite(element, "cy", patch.cy);
      setOptionalPositive(element, "rx", patch.rx);
      setOptionalPositive(element, "ry", patch.ry);
      break;
    case "line":
      setOptionalFinite(element, "x1", patch.x1);
      setOptionalFinite(element, "y1", patch.y1);
      setOptionalFinite(element, "x2", patch.x2);
      setOptionalFinite(element, "y2", patch.y2);
      break;
    case "polygon":
    case "polyline":
      if (patch.points !== undefined) setPoints(element, patch.points);
      break;
    case "text":
      setOptionalFinite(element, "x", patch.x);
      setOptionalFinite(element, "y", patch.y);
      break;
  }
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
function serializeTransform(transform: ElementTransform): string {
  switch (transform.kind) {
    case "translate":
      assertFinite(transform.x, "transform x");
      assertFinite(transform.y, "transform y");
      return `translate(${transform.x} ${transform.y})`;
    case "scale": {
      const y = transform.y ?? transform.x;
      assertNonZero(transform.x, "scale x");
      assertNonZero(y, "scale y");
      return `scale(${transform.x} ${y})`;
    }
    case "rotate":
      assertFinite(transform.angle, "rotation angle");
      if (transform.cx === undefined && transform.cy === undefined)
        return `rotate(${transform.angle})`;
      if (transform.cx === undefined || transform.cy === undefined)
        throw new Error("Rotation center requires both cx and cy");
      assertFinite(transform.cx, "rotation cx");
      assertFinite(transform.cy, "rotation cy");
      return `rotate(${transform.angle} ${transform.cx} ${transform.cy})`;
    case "skew_x":
    case "skew_y":
      assertFinite(transform.angle, "skew angle");
      return `${transform.kind === "skew_x" ? "skewX" : "skewY"}(${transform.angle})`;
    case "flip_x":
      return "scale(-1 1)";
    case "flip_y":
      return "scale(1 -1)";
    case "matrix": {
      for (const [name, value] of Object.entries(transform)) {
        if (name !== "kind") assertFinite(value as number, `matrix ${name}`);
      }
      if (transform.a * transform.d - transform.b * transform.c === 0)
        throw new Error("Transform matrix must be invertible");
      return `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`;
    }
  }
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
function isLayer(element: XmlElement): boolean {
  return (
    element.localName === "g" &&
    element.getAttributeNS(
      "http://www.inkscape.org/namespaces/inkscape",
      "groupmode",
    ) === "layer"
  );
}
function childElements(parent: XmlElement): XmlElement[] {
  const elements: XmlElement[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) elements.push(node as XmlElement);
  }
  return elements;
}
function parentElement(element: XmlElement): XmlElement | undefined {
  return element.parentNode?.nodeType === 1
    ? (element.parentNode as XmlElement)
    : undefined;
}
function nextElementSibling(element: XmlElement): XmlElement | undefined {
  for (let node = element.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === 1) return node as XmlElement;
  }
  return undefined;
}
function previousElementSibling(element: XmlElement): XmlElement | undefined {
  for (let node = element.previousSibling; node; node = node.previousSibling) {
    if (node.nodeType === 1) return node as XmlElement;
  }
  return undefined;
}
function setFinite(element: XmlElement, name: string, value: number): void {
  assertFinite(value, name);
  element.setAttribute(name, String(value));
}
function setOptionalFinite(
  element: XmlElement,
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  setFinite(element, name, value);
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
function setOptionalPositive(
  element: XmlElement,
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  setPositive(element, name, value);
}
function setPoints(
  element: XmlElement,
  points: readonly { x: number; y: number }[],
): void {
  if (points.length < 2 || points.length > 1_000)
    throw new Error("Polyline or polygon needs between two and 1000 points");
  element.setAttribute(
    "points",
    points
      .map((point) => {
        assertFinite(point.x, "point x");
        assertFinite(point.y, "point y");
        return `${point.x},${point.y}`;
      })
      .join(" "),
  );
}
function color(value: string): string {
  if (!COLOR.test(value)) throw new Error("Shape colors must be #rrggbb");
  return value.toLowerCase();
}
function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
function assertNonZero(value: number, name: string): void {
  assertFinite(value, name);
  if (value === 0) throw new Error(`${name} must not be zero`);
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
function validateText(value: string): void {
  if (value.length > 10_000 || hasControlCharacters(value))
    throw new Error("Text content is invalid or too long");
}
