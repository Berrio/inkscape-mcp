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
export type ElementGroupAction = "group" | "ungroup";
export type ElementDuplicateRequest = {
  id: string;
  mode: "copy" | "use";
  newId: string;
  parentId?: string | undefined;
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
      cx: number;
      cy: number;
      kind: "regular_polygon";
      points: number;
      r: number;
      rotation?: number | undefined;
    })
  | (ShapeBase & {
      cx: number;
      cy: number;
      kind: "star";
      points: number;
      r1: number;
      r2: number;
      rotation?: number | undefined;
    })
  | (ShapeBase & {
      cx: number;
      cy: number;
      kind: "spiral";
      r: number;
      rotation?: number | undefined;
      turns: number;
    })
  | (ShapeBase & { d: string; kind: "path" })
  | (ShapeBase & {
      height: number;
      href: string;
      kind: "image";
      preserveAspectRatio?: "none" | "xMidYMid meet" | "xMidYMid slice";
      width: number;
      x: number;
      y: number;
    })
  | (ShapeBase & {
      kind: "text";
      spans?:
        | readonly {
            dx?: number | undefined;
            dy?: number | undefined;
            text: string;
          }[]
        | undefined;
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
    const id = shape.id ?? nextGeneratedId(usedIds);
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
function nextGeneratedId(usedIds: ReadonlySet<string>): string {
  for (let index = 1; index <= 1_000_000; index += 1) {
    const id = `shape_${index}`;
    if (!usedIds.has(id)) return id;
  }
  throw new Error("No generated shape ID is available");
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
  const deletedReferenceIds = new Set<string>();
  for (const target of targets)
    for (const element of [
      target,
      ...Array.from(target.getElementsByTagName("*")),
    ]) {
      const id = element.getAttribute("id");
      if (id !== null) deletedReferenceIds.add(id);
    }
  for (const element of elements) {
    if (isWithinDeletedTree(element, targetSet)) continue;
    if (referencesDeletedId(element, deletedReferenceIds))
      throw new Error("Deleting this shape would break an SVG reference");
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

/** Duplicates one simple element or creates an explicit SVG <use> clone. */
export function duplicateSvgShape(
  source: string,
  request: ElementDuplicateRequest,
): { id: string; svg: string } {
  if (!SAFE_ID.test(request.id) || !SAFE_ID.test(request.newId))
    throw new Error("Shape ID is invalid");
  if (request.parentId !== undefined && !SAFE_ID.test(request.parentId))
    throw new Error("Shape parent ID is invalid");
  const document = parseSafeDocument(source);
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  const elements = Array.from(document.getElementsByTagName("*"));
  const original = elements.find(
    (element) => element.getAttribute("id") === request.id,
  );
  if (!original) throw new Error("Shape ID does not exist");
  if (elements.some((element) => element.getAttribute("id") === request.newId))
    throw new Error("Shape ID already exists");
  const parent =
    request.parentId === undefined
      ? parentElement(original)
      : resolveParent(document, root, request.parentId);
  if (!parent) throw new Error("Shape parent is missing");
  if (request.mode === "copy") {
    const descendantIds = Array.from(original.getElementsByTagName("*")).some(
      (element) => element.hasAttribute("id"),
    );
    if (descendantIds)
      throw new Error(
        "Copying an element subtree with descendant IDs requires ID remapping",
      );
    const copy = original.cloneNode(true) as XmlElement;
    copy.setAttribute("id", request.newId);
    if (parent === parentElement(original))
      parent.insertBefore(copy, original.nextSibling);
    else parent.appendChild(copy);
  } else {
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("id", request.newId);
    use.setAttribute("href", `#${request.id}`);
    if (parent === parentElement(original))
      parent.insertBefore(use, original.nextSibling);
    else parent.appendChild(use);
  }
  return {
    id: request.newId,
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

export function groupSvgShapes(
  source: string,
  request:
    | { action: "group"; groupId: string; ids: readonly string[] }
    | { action: "ungroup"; groupId: string },
): { ids: readonly string[]; svg: string } {
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  if (!SAFE_ID.test(request.groupId)) throw new Error("Shape ID is invalid");
  if (request.action === "group") {
    if (request.ids.length < 1 || request.ids.length > 100)
      throw new Error("Group batch must contain between one and 100 IDs");
    if (new Set(request.ids).size !== request.ids.length)
      throw new Error("Group IDs must be unique");
    if (
      elements.some((element) => element.getAttribute("id") === request.groupId)
    )
      throw new Error("Shape ID already exists");
    const targets = request.ids.map((id) => {
      if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
      const target = elements.find(
        (element) => element.getAttribute("id") === id,
      );
      if (!target) throw new Error("Shape ID does not exist");
      return target;
    });
    const parent = parentElement(targets[0]!);
    if (!parent || targets.some((target) => parentElement(target) !== parent))
      throw new Error("Group targets must share the same parent");
    const ordered = childElements(parent).filter((element) =>
      targets.includes(element),
    );
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("id", request.groupId);
    parent.insertBefore(group, ordered[0]!);
    for (const target of ordered) group.appendChild(target);
    return {
      ids: [...request.ids, request.groupId],
      svg: new XMLSerializer().serializeToString(document),
    };
  }
  const group = elements.find(
    (element) => element.getAttribute("id") === request.groupId,
  );
  if (!group || group.localName !== "g" || isLayer(group))
    throw new Error("Ungroup requires a non-layer SVG group");
  const parent = parentElement(group);
  if (!parent) throw new Error("SVG group parent is missing");
  for (const element of elements) {
    if (isWithinDeletedTree(element, new Set([group]))) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (
        attribute &&
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        attribute.value.trim() === `#${request.groupId}`
      )
        throw new Error("Ungrouping this group would break an SVG reference");
    }
  }
  while (group.firstChild) parent.insertBefore(group.firstChild, group);
  parent.removeChild(group);
  return {
    ids: [request.groupId],
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
    shape.kind === "layer"
      ? "g"
      : shape.kind === "regular_polygon" || shape.kind === "star"
        ? "polygon"
        : shape.kind === "spiral"
          ? "path"
          : shape.kind,
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
    case "regular_polygon":
      element.setAttribute(
        "points",
        generatedPolygonPoints(
          shape.cx,
          shape.cy,
          [shape.r],
          shape.points,
          shape.rotation,
        ),
      );
      break;
    case "star":
      element.setAttribute(
        "points",
        generatedPolygonPoints(
          shape.cx,
          shape.cy,
          [shape.r1, shape.r2],
          shape.points,
          shape.rotation,
        ),
      );
      break;
    case "spiral":
      element.setAttribute(
        "d",
        generatedSpiralPath(
          shape.cx,
          shape.cy,
          shape.r,
          shape.turns,
          shape.rotation,
        ),
      );
      break;
    case "path":
      validatePathData(shape.d);
      element.setAttribute("d", shape.d.trim());
      break;
    case "image":
      setFinite(element, "x", shape.x);
      setFinite(element, "y", shape.y);
      setPositive(element, "width", shape.width);
      setPositive(element, "height", shape.height);
      validateImageHref(shape.href);
      element.setAttribute("href", shape.href);
      if (shape.preserveAspectRatio !== undefined)
        element.setAttribute("preserveAspectRatio", shape.preserveAspectRatio);
      break;
    case "text":
      validateText(shape.text);
      setFinite(element, "x", shape.x);
      setFinite(element, "y", shape.y);
      if (shape.spans === undefined || shape.spans.length === 0) {
        element.textContent = shape.text;
      } else {
        if (shape.spans.length > 100)
          throw new Error("Text accepts at most 100 tspans");
        element.appendChild(document.createTextNode(shape.text));
        for (const span of shape.spans) {
          validateText(span.text);
          const tspan = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "tspan",
          );
          setOptionalFinite(tspan, "dx", span.dx);
          setOptionalFinite(tspan, "dy", span.dy);
          tspan.textContent = span.text;
          element.appendChild(tspan);
        }
      }
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
function referencesDeletedId(
  element: XmlElement,
  deletedIds: ReadonlySet<string>,
): boolean {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (
      (name === "href" || name === "xlink:href") &&
      value.startsWith("#") &&
      deletedIds.has(value.slice(1))
    )
      return true;
    if (
      (name === "aria-describedby" || name === "aria-labelledby") &&
      value.split(/\s+/u).some((id) => deletedIds.has(id))
    )
      return true;
    if (containsDeletedUrlFragment(attribute.value, deletedIds)) return true;
  }
  return (
    element.localName === "style" &&
    containsDeletedUrlFragment(element.textContent ?? "", deletedIds)
  );
}
function containsDeletedUrlFragment(
  value: string,
  deletedIds: ReadonlySet<string>,
): boolean {
  for (const match of value.matchAll(
    /url\(\s*(?:(['"])#([^'"]+)\1|#([^)]*?))\s*\)/giu,
  )) {
    const id = (match[2] ?? match[3] ?? "").trim();
    if (deletedIds.has(id)) return true;
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
function generatedPolygonPoints(
  cx: number,
  cy: number,
  radii: readonly number[],
  count: number,
  rotation: number | undefined,
): string {
  assertFinite(cx, "cx");
  assertFinite(cy, "cy");
  for (const radius of radii)
    assertRange(radius, "radius", Number.MIN_VALUE, Number.POSITIVE_INFINITY);
  if (!Number.isInteger(count) || count < 3 || count > 1_000)
    throw new Error("Polygon point count is out of range");
  const angle = rotation ?? -90;
  assertFinite(angle, "rotation");
  return Array.from({ length: count * radii.length }, (_, index) => {
    const radians =
      ((angle + (360 * index) / (count * radii.length)) * Math.PI) / 180;
    const radius = radii[index % radii.length]!;
    return `${cx + Math.cos(radians) * radius},${cy + Math.sin(radians) * radius}`;
  }).join(" ");
}
function generatedSpiralPath(
  cx: number,
  cy: number,
  radius: number,
  turns: number,
  rotation: number | undefined,
): string {
  assertFinite(cx, "cx");
  assertFinite(cy, "cy");
  assertRange(radius, "radius", Number.MIN_VALUE, Number.POSITIVE_INFINITY);
  assertRange(turns, "turns", 0.1, 100);
  const angle = rotation ?? -90;
  assertFinite(angle, "rotation");
  const segments = Math.min(1_000, Math.max(16, Math.ceil(turns * 64)));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const ratio = index / segments;
    const radians = ((angle + ratio * turns * 360) * Math.PI) / 180;
    const x = cx + Math.cos(radians) * radius * ratio;
    const y = cy + Math.sin(radians) * radius * ratio;
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
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
function validateImageHref(value: string): void {
  if (
    value.length < 1 ||
    value.length > 75 * 1024 * 1024 ||
    hasControlCharacters(value)
  )
    throw new Error("Image href is invalid");
  if (
    /^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/iu.test(
      value,
    )
  )
    return;
  if (
    /^(?:[a-z][a-z0-9+.-]*:|\/|\\|\/\/)/iu.test(value) ||
    value.startsWith("#")
  )
    throw new Error("Image href must be a local relative raster resource");
}
function validatePathData(value: string): void {
  if (value.length < 1 || value.length > 100_000)
    throw new Error("Path data is invalid or too long");
  const tokens = value.match(
    /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/gu,
  );
  if (!tokens || value.replace(/[\s,]/gu, "") !== tokens.join(""))
    throw new Error("Path data has invalid syntax");
  if (tokens[0]!.toUpperCase() !== "M")
    throw new Error("Path data must start with a moveto command");
  const arity: Readonly<Record<string, number>> = {
    A: 7,
    C: 6,
    H: 1,
    L: 2,
    M: 2,
    Q: 4,
    S: 4,
    T: 2,
    V: 1,
    Z: 0,
  };
  let command: string | undefined;
  let index = 0;
  let hasMove = false;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[A-Za-z]$/u.test(token)) {
      command = token.toUpperCase();
      index += 1;
      if (!(command in arity)) throw new Error("Path command is unsupported");
      if (command === "Z") {
        command = undefined;
        continue;
      }
    }
    if (!command) throw new Error("Path data must start with a command");
    const count = arity[command]!;
    if (index + count > tokens.length)
      throw new Error("Path command is incomplete");
    if (command === "M" && !hasMove) hasMove = true;
    for (let parameter = 0; parameter < count; parameter += 1) {
      const number = Number(tokens[index + parameter]);
      if (!Number.isFinite(number))
        throw new Error("Path coordinate must be finite");
      if (command === "A" && parameter < 2 && number < 0)
        throw new Error("Path arc radii must be non-negative");
      if (
        command === "A" &&
        (parameter === 3 || parameter === 4) &&
        number !== 0 &&
        number !== 1
      )
        throw new Error("Path arc flags must be zero or one");
    }
    index += count;
    if (command === "M") command = "L";
  }
  if (!hasMove) throw new Error("Path data must contain a moveto command");
}
