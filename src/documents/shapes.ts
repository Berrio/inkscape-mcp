import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";
import {
  editAbsoluteLinearSvgPathNode,
  moveAbsoluteSvgPathNode,
  parseSvgPathData,
  reverseLinearSvgPathData,
  splitSvgPathSubpaths,
  serializeSvgPathData,
} from "./path-data.js";

export type ShapeStyle = {
  classes?: readonly string[] | undefined;
  display?: "inline" | "none" | undefined;
  fill?: string | undefined;
  fillOpacity?: number | undefined;
  fillRule?: "evenodd" | "nonzero" | undefined;
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  fontStyle?: "italic" | "normal" | "oblique" | undefined;
  fontWeight?: "bold" | "normal" | number | undefined;
  letterSpacing?: number | undefined;
  locked?: boolean | undefined;
  opacity?: number | undefined;
  paintOrder?:
    "normal" | "fill stroke markers" | "stroke fill markers" | undefined;
  stroke?: string | undefined;
  strokeDasharray?: readonly number[] | undefined;
  strokeLineCap?: "butt" | "round" | "square" | undefined;
  strokeLineJoin?: "bevel" | "miter" | "round" | undefined;
  strokeMiterLimit?: number | undefined;
  strokeOpacity?: number | undefined;
  strokeWidth?: number | undefined;
  textAnchor?: "end" | "middle" | "start" | undefined;
  visibility?: "hidden" | "visible" | undefined;
  wordSpacing?: number | undefined;
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
export type ElementArrangeAction =
  "back" | "front" | "lower" | "raise" | "index" | "before" | "after";
export type ElementArrangeOptions = {
  index?: number | undefined;
  relativeTo?: string | undefined;
};
export type ElementGroupAction = "group" | "ungroup";
export type ElementDuplicateRequest = {
  id: string;
  mode: "copy" | "use";
  newId: string;
  parentId?: string | undefined;
};
export type ElementReparentRequest = {
  ids: readonly string[];
  parentId: string;
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
const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";

/** Creates one Inkscape semantic connector without accepting arbitrary XML. */
export function createSvgConnector(
  source: string,
  spec: {
    fromId: string;
    id: string;
    points: readonly [number, number][];
    toId: string;
  },
): string {
  if (
    !SAFE_ID.test(spec.id) ||
    !SAFE_ID.test(spec.fromId) ||
    !SAFE_ID.test(spec.toId) ||
    spec.fromId === spec.toId ||
    spec.points.length < 2 ||
    spec.points.length > 100 ||
    spec.points.some(
      (point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]),
    )
  )
    throw new Error("Connector specification is invalid");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  if (elements.some((element) => element.getAttribute("id") === spec.id))
    throw new Error("Connector ID already exists");
  if (
    !elements.some((element) => element.getAttribute("id") === spec.fromId) ||
    !elements.some((element) => element.getAttribute("id") === spec.toId)
  )
    throw new Error("Connector endpoint ID does not exist");
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  if (!root.hasAttribute("xmlns:inkscape"))
    root.setAttribute("xmlns:inkscape", INKSCAPE_NAMESPACE);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("id", spec.id);
  path.setAttribute(
    "d",
    spec.points
      .map(
        (point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`,
      )
      .join(" "),
  );
  path.setAttribute("fill", "none");
  path.setAttribute("inkscape:connector-type", "polyline");
  path.setAttribute("inkscape:connection-start", `#${spec.fromId}`);
  path.setAttribute("inkscape:connection-end", `#${spec.toId}`);
  root.appendChild(path);
  return new XMLSerializer().serializeToString(document);
}

/** Retargets an existing semantic connector while preserving its routed polyline. */
export function retargetSvgConnector(
  source: string,
  id: string,
  fromId: string,
  toId: string,
): string {
  if (
    !SAFE_ID.test(id) ||
    !SAFE_ID.test(fromId) ||
    !SAFE_ID.test(toId) ||
    fromId === toId
  )
    throw new Error("Connector retarget specification is invalid");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const connector = elements.find(
    (element) => element.getAttribute("id") === id,
  );
  if (
    !connector ||
    connector.localName !== "path" ||
    connector.getAttribute("inkscape:connector-type") === null
  )
    throw new Error("Connector ID does not reference a semantic connector");
  if (
    !elements.some((element) => element.getAttribute("id") === fromId) ||
    !elements.some((element) => element.getAttribute("id") === toId)
  )
    throw new Error("Connector endpoint ID does not exist");
  connector.setAttribute("inkscape:connection-start", `#${fromId}`);
  connector.setAttribute("inkscape:connection-end", `#${toId}`);
  return new XMLSerializer().serializeToString(document);
}

/** Routes one semantic connector through centers of simple axis-aligned shapes. */
export function routeSvgConnector(
  source: string,
  request: {
    axis: "auto" | "horizontal-first" | "vertical-first";
    clearance?: number | undefined;
    fromId: string;
    id: string;
    obstacleIds?: readonly string[] | undefined;
    toId: string;
  },
): {
  avoidedObstacleIds: readonly string[];
  points: readonly [number, number][];
  svg: string;
} {
  if (
    !SAFE_ID.test(request.id) ||
    !SAFE_ID.test(request.fromId) ||
    !SAFE_ID.test(request.toId) ||
    request.fromId === request.toId
  )
    throw new Error("Connector route specification is invalid");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const connector = elements.find(
    (element) => element.getAttribute("id") === request.id,
  );
  if (
    !connector ||
    connector.localName !== "path" ||
    connector.getAttribute("inkscape:connector-type") === null
  )
    throw new Error("Connector ID does not reference a semantic connector");
  const from = elements.find(
    (element) => element.getAttribute("id") === request.fromId,
  );
  const to = elements.find(
    (element) => element.getAttribute("id") === request.toId,
  );
  if (!from || !to) throw new Error("Connector endpoint ID does not exist");
  const start = connectorShapeCenter(from);
  const end = connectorShapeCenter(to);
  const obstacleIds = request.obstacleIds ?? [];
  if (
    obstacleIds.length > 20 ||
    new Set(obstacleIds).size !== obstacleIds.length ||
    obstacleIds.some(
      (obstacleId) =>
        !SAFE_ID.test(obstacleId) ||
        obstacleId === request.id ||
        obstacleId === request.fromId ||
        obstacleId === request.toId,
    )
  )
    throw new Error("Connector obstacle IDs are invalid");
  const clearance = request.clearance ?? 4;
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 100_000)
    throw new Error("Connector obstacle clearance is invalid");
  const axis =
    request.axis === "auto"
      ? Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
        ? "horizontal-first"
        : "vertical-first"
      : request.axis;
  const obstacles = obstacleIds.map((obstacleId) => {
    const obstacle = elements.find(
      (element) => element.getAttribute("id") === obstacleId,
    );
    if (!obstacle)
      throw new Error(`Connector obstacle ID does not exist: ${obstacleId}`);
    return connectorShapeBounds(obstacle, clearance);
  });
  const points =
    obstacles.length === 0
      ? compactConnectorPoints(
          axis === "horizontal-first"
            ? [
                [start.x, start.y],
                [(start.x + end.x) / 2, start.y],
                [(start.x + end.x) / 2, end.y],
                [end.x, end.y],
              ]
            : [
                [start.x, start.y],
                [start.x, (start.y + end.y) / 2],
                [end.x, (start.y + end.y) / 2],
                [end.x, end.y],
              ],
        )
      : routeAroundConnectorObstacles(start, end, obstacles, axis);
  connector.setAttribute(
    "d",
    points
      .map(
        (point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`,
      )
      .join(" "),
  );
  connector.setAttribute("inkscape:connection-start", `#${request.fromId}`);
  connector.setAttribute("inkscape:connection-end", `#${request.toId}`);
  return {
    avoidedObstacleIds: obstacleIds,
    points,
    svg: new XMLSerializer().serializeToString(document),
  };
}

function connectorShapeCenter(element: XmlElement): { x: number; y: number } {
  const attr = (name: string, fallback = 0) => {
    const value = element.getAttribute(name);
    const parsed = value === null ? fallback : Number(value);
    if (!Number.isFinite(parsed))
      throw new Error("Connector endpoint geometry must be finite");
    return parsed;
  };
  let center: { x: number; y: number };
  if (element.localName === "rect") {
    const width = attr("width");
    const height = attr("height");
    if (width <= 0 || height <= 0)
      throw new Error(
        "Connector endpoint rectangle must have positive dimensions",
      );
    center = { x: attr("x") + width / 2, y: attr("y") + height / 2 };
  } else if (element.localName === "circle") {
    if (attr("r") <= 0)
      throw new Error("Connector endpoint circle must have a positive radius");
    center = { x: attr("cx"), y: attr("cy") };
  } else if (element.localName === "ellipse") {
    if (attr("rx") <= 0 || attr("ry") <= 0)
      throw new Error("Connector endpoint ellipse must have positive radii");
    center = { x: attr("cx"), y: attr("cy") };
  } else {
    throw new Error(
      "Connector routing supports rect, circle, and ellipse endpoints",
    );
  }
  const transform = element.getAttribute("transform");
  if (transform === null) return center;
  let matrix: AxisAlignedMatrix;
  try {
    matrix = parseAxisAlignedTransform(transform);
  } catch {
    throw new Error(
      "Connector routing supports only axis-aligned endpoint transforms",
    );
  }
  return {
    x: matrix.a * center.x + matrix.e,
    y: matrix.d * center.y + matrix.f,
  };
}

type ConnectorObstacle = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

function connectorShapeBounds(
  element: XmlElement,
  clearance: number,
): ConnectorObstacle {
  const attr = (name: string, fallback = 0) => {
    const value = element.getAttribute(name);
    const parsed = value === null ? fallback : Number(value);
    if (!Number.isFinite(parsed))
      throw new Error("Connector obstacle geometry must be finite");
    return parsed;
  };
  let bounds: ConnectorObstacle;
  if (element.localName === "rect") {
    const width = attr("width");
    const height = attr("height");
    if (width <= 0 || height <= 0)
      throw new Error(
        "Connector obstacle rectangle must have positive dimensions",
      );
    bounds = {
      bottom: attr("y") + height,
      left: attr("x"),
      right: attr("x") + width,
      top: attr("y"),
    };
  } else if (element.localName === "circle") {
    const radius = attr("r");
    if (radius <= 0)
      throw new Error("Connector obstacle circle must have a positive radius");
    bounds = {
      bottom: attr("cy") + radius,
      left: attr("cx") - radius,
      right: attr("cx") + radius,
      top: attr("cy") - radius,
    };
  } else if (element.localName === "ellipse") {
    const rx = attr("rx");
    const ry = attr("ry");
    if (rx <= 0 || ry <= 0)
      throw new Error("Connector obstacle ellipse must have positive radii");
    bounds = {
      bottom: attr("cy") + ry,
      left: attr("cx") - rx,
      right: attr("cx") + rx,
      top: attr("cy") - ry,
    };
  } else {
    throw new Error(
      "Connector routing obstacles support only rect, circle, and ellipse",
    );
  }
  const transform = element.getAttribute("transform");
  const matrix =
    transform === null ? undefined : parseAxisAlignedTransform(transform);
  const transformed =
    matrix === undefined
      ? bounds
      : {
          bottom: Math.max(
            matrix.d * bounds.top + matrix.f,
            matrix.d * bounds.bottom + matrix.f,
          ),
          left: Math.min(
            matrix.a * bounds.left + matrix.e,
            matrix.a * bounds.right + matrix.e,
          ),
          right: Math.max(
            matrix.a * bounds.left + matrix.e,
            matrix.a * bounds.right + matrix.e,
          ),
          top: Math.min(
            matrix.d * bounds.top + matrix.f,
            matrix.d * bounds.bottom + matrix.f,
          ),
        };
  return {
    bottom: transformed.bottom + clearance,
    left: transformed.left - clearance,
    right: transformed.right + clearance,
    top: transformed.top - clearance,
  };
}

function routeAroundConnectorObstacles(
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacles: readonly ConnectorObstacle[],
  preferredAxis: "horizontal-first" | "vertical-first",
): [number, number][] {
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...obstacles.flatMap((item) => [item.left, item.right]),
    ]),
  ].sort((left, right) => left - right);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...obstacles.flatMap((item) => [item.top, item.bottom]),
    ]),
  ].sort((top, bottom) => top - bottom);
  const points = xs.flatMap((x) =>
    ys
      .filter(
        (y) =>
          (x === start.x && y === start.y) ||
          (x === end.x && y === end.y) ||
          !obstacles.some(
            (obstacle) =>
              x > obstacle.left &&
              x < obstacle.right &&
              y > obstacle.top &&
              y < obstacle.bottom,
          ),
      )
      .map((y) => ({ x, y })),
  );
  const pointIndex = new Map(
    points.map((point, index) => [`${point.x},${point.y}`, index]),
  );
  const startIndex = pointIndex.get(`${start.x},${start.y}`);
  const endIndex = pointIndex.get(`${end.x},${end.y}`);
  if (startIndex === undefined || endIndex === undefined)
    throw new Error(
      "Connector endpoints cannot be routed around selected obstacles",
    );
  const links = points.map(
    () =>
      [] as { axis: "horizontal" | "vertical"; distance: number; to: number }[],
  );
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    for (let next = index + 1; next < points.length; next += 1) {
      const candidate = points[next]!;
      const horizontal = current.y === candidate.y;
      const vertical = current.x === candidate.x;
      if (!horizontal && !vertical) continue;
      const axis = horizontal ? "horizontal" : "vertical";
      if (
        obstacles.some((obstacle) =>
          segmentCrossesObstacle(current, candidate, obstacle),
        )
      )
        continue;
      const distance = horizontal
        ? Math.abs(candidate.x - current.x)
        : Math.abs(candidate.y - current.y);
      if (distance === 0) continue;
      links[index]!.push({ axis, distance, to: next });
      links[next]!.push({ axis, distance, to: index });
    }
  }
  return shortestConnectorPath(
    points,
    links,
    startIndex,
    endIndex,
    preferredAxis,
  );
}

function segmentCrossesObstacle(
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacle: ConnectorObstacle,
): boolean {
  if (start.y === end.y)
    return (
      start.y > obstacle.top &&
      start.y < obstacle.bottom &&
      Math.max(start.x, end.x) > obstacle.left &&
      Math.min(start.x, end.x) < obstacle.right
    );
  return (
    start.x > obstacle.left &&
    start.x < obstacle.right &&
    Math.max(start.y, end.y) > obstacle.top &&
    Math.min(start.y, end.y) < obstacle.bottom
  );
}

function shortestConnectorPath(
  points: readonly { x: number; y: number }[],
  links: readonly (readonly {
    axis: "horizontal" | "vertical";
    distance: number;
    to: number;
  }[])[],
  start: number,
  end: number,
  preferredAxis: "horizontal-first" | "vertical-first",
): [number, number][] {
  type State = { axis?: "horizontal" | "vertical"; point: number };
  const key = (state: State) => `${state.point}:${state.axis ?? "start"}`;
  const initial: State = { point: start };
  const cost = new Map([[key(initial), 0]]);
  const predecessor = new Map<string, State>();
  const pending = [initial];
  let target: State | undefined;
  while (pending.length > 0) {
    pending.sort((left, right) => cost.get(key(left))! - cost.get(key(right))!);
    const current = pending.shift()!;
    const currentCost = cost.get(key(current))!;
    if (current.point === end) {
      target = current;
      break;
    }
    for (const link of links[current.point]!) {
      const next: State = { axis: link.axis, point: link.to };
      const preferred =
        current.axis === undefined &&
        link.axis !==
          (preferredAxis === "horizontal-first" ? "horizontal" : "vertical");
      const turn = current.axis !== undefined && current.axis !== link.axis;
      const nextCost =
        currentCost + link.distance + (preferred || turn ? 0.001 : 0);
      if (nextCost >= (cost.get(key(next)) ?? Number.POSITIVE_INFINITY))
        continue;
      cost.set(key(next), nextCost);
      predecessor.set(key(next), current);
      pending.push(next);
    }
  }
  if (target === undefined)
    throw new Error(
      "No orthogonal route avoids the selected connector obstacles",
    );
  const path: [number, number][] = [];
  for (
    let current: State | undefined = target;
    current !== undefined;
    current = predecessor.get(key(current))
  ) {
    const point = points[current.point]!;
    path.push([point.x, point.y]);
  }
  return compactConnectorPoints(path.reverse());
}

function compactConnectorPoints(
  points: readonly [number, number][],
): [number, number][] {
  const deduplicated = points.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== points[index - 1]![0] ||
      point[1] !== points[index - 1]![1],
  );
  return deduplicated.filter(
    (point, index) =>
      index === 0 ||
      index === deduplicated.length - 1 ||
      !(
        (deduplicated[index - 1]![0] === point[0] &&
          point[0] === deduplicated[index + 1]![0]) ||
        (deduplicated[index - 1]![1] === point[1] &&
          point[1] === deduplicated[index + 1]![1])
      ),
  );
}
const SAFE_CLASS = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;

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

/**
 * Bakes an element's own axis-aligned transform into supported primitive
 * geometry. Ancestor transforms are deliberately rejected: removing them
 * would also move siblings and silently alter the rest of the document.
 */
export function flattenSvgShapeTransforms(
  source: string,
  ids: readonly string[],
): { flattenedIds: readonly string[]; svg: string } {
  if (ids.length < 1 || ids.length > 100)
    throw new Error("Flatten batch must contain between one and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Flatten IDs must be unique");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const flattenedIds: string[] = [];
  for (const id of ids) {
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    const element = elements.find(
      (candidate) => candidate.getAttribute("id") === id,
    );
    if (!element) throw new Error("Shape ID does not exist");
    if (hasTransformedAncestor(element))
      throw new Error(
        "Flattening an inherited transform requires selecting a self-contained subtree",
      );
    const transform = element.getAttribute("transform");
    if (transform === null) continue;
    flattenAxisAlignedTransform(element, parseAxisAlignedTransform(transform));
    element.removeAttribute("transform");
    flattenedIds.push(id);
  }
  return {
    flattenedIds,
    svg: new XMLSerializer().serializeToString(document),
  };
}

/** Combines style-equivalent, same-parent SVG paths without changing geometry. */
export function combineSvgPaths(
  source: string,
  ids: readonly string[],
): { id: string; removedIds: readonly string[]; svg: string } {
  if (ids.length < 2 || ids.length > 100)
    throw new Error("Path combine requires between two and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Path combine IDs must be unique");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const paths = ids.map((id) => requirePathElement(elements, id));
  const first = paths[0]!;
  const parent = parentElement(first);
  if (!parent || paths.some((path) => parentElement(path) !== parent))
    throw new Error("Combined paths must share the same parent");
  const signature = pathPresentationSignature(first);
  if (paths.some((path) => pathPresentationSignature(path) !== signature))
    throw new Error(
      "Combined paths must have identical presentation attributes",
    );
  const removedIds = ids.slice(1);
  assertIdsUnreferencedOutside(elements, new Set(paths.slice(1)), removedIds);
  first.setAttribute(
    "d",
    paths
      .map((path) => {
        const data = path.getAttribute("d");
        if (data === null) throw new Error("Path data is missing");
        return serializeSvgPathData(parseSvgPathData(data));
      })
      .join(" "),
  );
  for (const path of paths.slice(1)) path.parentNode?.removeChild(path);
  return {
    id: ids[0]!,
    removedIds,
    svg: new XMLSerializer().serializeToString(document),
  };
}

/** Replaces a compound path with explicitly named path elements per subpath. */
export function breakApartSvgPath(
  source: string,
  id: string,
  newIds: readonly string[],
): { ids: readonly string[]; svg: string } {
  if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
  if (newIds.length < 2 || newIds.length > 100)
    throw new Error("Break apart requires between two and 100 new IDs");
  if (
    new Set(newIds).size !== newIds.length ||
    newIds.some((item) => !SAFE_ID.test(item))
  )
    throw new Error("Break apart IDs must be unique valid shape IDs");
  const document = parseSafeDocument(source);
  const elements = Array.from(document.getElementsByTagName("*"));
  const path = requirePathElement(elements, id);
  if (
    elements.some((element) => {
      const candidate = element.getAttribute("id");
      return (
        candidate !== id && candidate !== null && newIds.includes(candidate)
      );
    })
  )
    throw new Error("Shape ID already exists");
  assertIdsUnreferencedOutside(elements, new Set([path]), [id]);
  const data = path.getAttribute("d");
  if (data === null) throw new Error("Path data is missing");
  const subpaths = splitSvgPathSubpaths(parseSvgPathData(data));
  if (subpaths.length !== newIds.length)
    throw new Error(
      "Break apart newIds must match the number of path subpaths",
    );
  const parent = parentElement(path);
  if (!parent) throw new Error("Path parent is missing");
  for (let index = 0; index < subpaths.length; index += 1) {
    const part = path.cloneNode(false) as XmlElement;
    part.setAttribute("id", newIds[index]!);
    part.setAttribute("d", serializeSvgPathData(subpaths[index]!));
    parent.insertBefore(part, path);
  }
  parent.removeChild(path);
  return {
    ids: [...newIds],
    svg: new XMLSerializer().serializeToString(document),
  };
}

/** Reverses SVG path subpaths while retaining element identity and style. */
export function reverseSvgPath(
  source: string,
  id: string,
): { id: string; svg: string } {
  const document = parseSafeDocument(source);
  const path = requirePathElement(
    Array.from(document.getElementsByTagName("*")),
    id,
  );
  const data = path.getAttribute("d");
  if (data === null) throw new Error("Path data is missing");
  path.setAttribute("d", reverseLinearSvgPathData(data));
  return { id, svg: new XMLSerializer().serializeToString(document) };
}

/** Moves a safe subset of explicit path nodes while preserving element identity. */
export function moveSvgPathNode(
  source: string,
  id: string,
  index: number,
  point: { x: number; y: number },
): { id: string; svg: string } {
  const document = parseSafeDocument(source);
  const path = requirePathElement(
    Array.from(document.getElementsByTagName("*")),
    id,
  );
  const data = path.getAttribute("d");
  if (data === null) throw new Error("Path data is missing");
  path.setAttribute("d", moveAbsoluteSvgPathNode(data, index, point));
  return { id, svg: new XMLSerializer().serializeToString(document) };
}

export function editSvgPathNode(
  source: string,
  id: string,
  request:
    | { action: "delete"; index: number }
    | { action: "insert"; index: number; point: { x: number; y: number } }
    | { action: "close_subpath"; index: number }
    | { action: "expand_smooth"; index: number }
    | { action: "open_subpath"; index: number }
    | {
        action: "set_quadratic_handle";
        control: { x: number; y: number };
        index: number;
      }
    | {
        action: "set_cubic_handles";
        control1: { x: number; y: number };
        control2: { x: number; y: number };
        index: number;
      }
    | {
        action: "set_arc_parameters";
        index: number;
        largeArc: boolean;
        rotation: number;
        rx: number;
        ry: number;
        sweep: boolean;
      }
    | { action: "set_command"; command: "L" | "T"; index: number },
): { id: string; svg: string } {
  const document = parseSafeDocument(source);
  const path = requirePathElement(
    Array.from(document.getElementsByTagName("*")),
    id,
  );
  const data = path.getAttribute("d");
  if (data === null) throw new Error("Path data is missing");
  path.setAttribute("d", editAbsoluteLinearSvgPathNode(data, request));
  return { id, svg: new XMLSerializer().serializeToString(document) };
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

/** Moves selected elements under one existing group/layer in document order. */
export function reparentSvgShapes(
  source: string,
  request: ElementReparentRequest,
): { ids: readonly string[]; svg: string } {
  if (request.ids.length < 1 || request.ids.length > 100)
    throw new Error("Reparent batch must contain between one and 100 IDs");
  if (new Set(request.ids).size !== request.ids.length)
    throw new Error("Reparent IDs must be unique");
  if (!SAFE_ID.test(request.parentId))
    throw new Error("Shape parent ID is invalid");
  const document = parseSafeDocument(source);
  const root = document.documentElement;
  if (!root) throw new Error("SVG root is missing");
  const elements = Array.from(document.getElementsByTagName("*"));
  const parent = resolveParent(document, root, request.parentId);
  const targets = request.ids.map((id) => {
    if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
    const target = elements.find(
      (element) => element.getAttribute("id") === id,
    );
    if (!target) throw new Error("Shape ID does not exist");
    if (target === parent || isDescendant(parent, target))
      throw new Error("Reparenting would create a cycle");
    return target;
  });
  const targetSet = new Set(targets);
  if (targets.some((target) => isDescendantOfSelected(target, targetSet)))
    throw new Error(
      "Reparent targets cannot include an ancestor and descendant",
    );
  const ordered = elements.filter((element) => targetSet.has(element));
  for (const target of ordered) parent.appendChild(target);
  return {
    ids: request.ids.slice(),
    svg: new XMLSerializer().serializeToString(document),
  };
}

export function arrangeSvgShapes(
  source: string,
  ids: readonly string[],
  action: ElementArrangeAction,
  options: ElementArrangeOptions = {},
): { ids: readonly string[]; svg: string } {
  if (ids.length < 1 || ids.length > 100)
    throw new Error("Arrange batch must contain between one and 100 IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("Arrange IDs must be unique");
  if ((action === "raise" || action === "lower") && ids.length !== 1)
    throw new Error("Raise and lower require exactly one ID");
  if (
    action === "index" &&
    (!Number.isInteger(options.index) ||
      options.index === undefined ||
      options.index < 0)
  )
    throw new Error("Index arrange requires a non-negative integer index");
  if (
    (action === "before" || action === "after") &&
    (!options.relativeTo || !SAFE_ID.test(options.relativeTo))
  )
    throw new Error("Relative arrange requires a valid relativeTo ID");
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
    case "index": {
      const index = options.index!;
      const remaining = childElements(parent).filter(
        (element) => !ordered.includes(element),
      );
      if (index > remaining.length)
        throw new Error("Arrange index exceeds the available sibling range");
      const reference = remaining[index];
      for (const target of ordered)
        parent.insertBefore(target, reference ?? null);
      break;
    }
    case "before":
    case "after": {
      const relative = childElements(parent).find(
        (element) => element.getAttribute("id") === options.relativeTo,
      );
      if (!relative)
        throw new Error("Relative arrange target must be a sibling");
      if (ordered.includes(relative))
        throw new Error("Relative arrange target cannot be selected");
      const reference = action === "before" ? relative : relative.nextSibling;
      for (const target of ordered) parent.insertBefore(target, reference);
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

function requirePathElement(
  elements: readonly XmlElement[],
  id: string,
): XmlElement {
  if (!SAFE_ID.test(id)) throw new Error("Shape ID is invalid");
  const path = elements.find((element) => element.getAttribute("id") === id);
  if (!path || path.localName !== "path")
    throw new Error("Path ID does not name an SVG path");
  return path;
}

function pathPresentationSignature(element: XmlElement): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.name !== "d" && attribute.name !== "id")
    .map((attribute) => [attribute.name, attribute.value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(attributes);
}

function assertIdsUnreferencedOutside(
  elements: readonly XmlElement[],
  removedElements: ReadonlySet<XmlElement>,
  removedIds: readonly string[],
): void {
  const ids = new Set(removedIds);
  for (const element of elements) {
    if (isWithinDeletedTree(element, removedElements)) continue;
    if (referencesDeletedId(element, ids))
      throw new Error("Replacing these paths would break an SVG reference");
  }
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

type AxisAlignedMatrix = {
  a: number;
  d: number;
  e: number;
  f: number;
};

function parseAxisAlignedTransform(value: string): AxisAlignedMatrix {
  const matcher = /([A-Za-z]+)\s*\(([^()]*)\)/gu;
  let cursor = 0;
  let matrix: AxisAlignedMatrix = { a: 1, d: 1, e: 0, f: 0 };
  for (const match of value.matchAll(matcher)) {
    if (!/^\s*,?\s*$/u.test(value.slice(cursor, match.index)))
      throw new Error("Transform syntax is invalid");
    cursor = (match.index ?? 0) + match[0].length;
    const name = match[1]!.toLowerCase();
    const values = parseTransformNumbers(match[2]!);
    let next: AxisAlignedMatrix;
    switch (name) {
      case "translate":
        if (values.length !== 1 && values.length !== 2)
          throw new Error("Translate transform is invalid");
        next = { a: 1, d: 1, e: values[0]!, f: values[1] ?? 0 };
        break;
      case "scale":
        if (values.length !== 1 && values.length !== 2)
          throw new Error("Scale transform is invalid");
        if (values[0] === 0 || (values[1] ?? values[0]) === 0)
          throw new Error("Scale transform must be invertible");
        next = { a: values[0]!, d: values[1] ?? values[0]!, e: 0, f: 0 };
        break;
      case "matrix":
        if (values.length !== 6) throw new Error("Matrix transform is invalid");
        if (values[1] !== 0 || values[2] !== 0)
          throw new Error(
            "Flatten currently supports only axis-aligned transforms",
          );
        if (values[0] === 0 || values[3] === 0)
          throw new Error("Transform matrix must be invertible");
        next = {
          a: values[0]!,
          d: values[3]!,
          e: values[4]!,
          f: values[5]!,
        };
        break;
      default:
        throw new Error(
          "Flatten currently supports only translate, scale and axis-aligned matrix transforms",
        );
    }
    matrix = multiplyAxisAligned(matrix, next);
  }
  if (!/^\s*$/u.test(value.slice(cursor)))
    throw new Error("Transform syntax is invalid");
  return matrix;
}

function parseTransformNumbers(value: string): number[] {
  const number = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/gu;
  const values = [...value.matchAll(number)].map((match) => Number(match[0]));
  const remainder = value.replace(number, "");
  if (
    !/^\s*(?:,\s*)*$/u.test(remainder) ||
    values.some((item) => !Number.isFinite(item))
  )
    throw new Error("Transform contains invalid numbers");
  return values;
}

function multiplyAxisAligned(
  left: AxisAlignedMatrix,
  right: AxisAlignedMatrix,
): AxisAlignedMatrix {
  return {
    a: left.a * right.a,
    d: left.d * right.d,
    e: left.a * right.e + left.e,
    f: left.d * right.f + left.f,
  };
}

function flattenAxisAlignedTransform(
  element: XmlElement,
  matrix: AxisAlignedMatrix,
): void {
  scaleStrokeForFlatten(element, matrix);
  switch (element.localName) {
    case "rect":
    case "image":
      flattenRectangle(element, matrix);
      break;
    case "circle":
      flattenCircle(element, matrix);
      break;
    case "ellipse":
      flattenEllipse(element, matrix);
      break;
    case "line":
      flattenLine(element, matrix);
      break;
    case "polygon":
    case "polyline":
      flattenPoints(element, matrix);
      break;
    case "text":
      if (matrix.a !== 1 || matrix.d !== 1)
        throw new Error("Flattening scaled text would change its typography");
      setFinite(
        element,
        "x",
        transformedNumber(element, "x", matrix.a, matrix.e),
      );
      setFinite(
        element,
        "y",
        transformedNumber(element, "y", matrix.d, matrix.f),
      );
      break;
    default:
      throw new Error(
        "Flatten supports rect, image, circle, ellipse, line, polygon, polyline and translated text",
      );
  }
}

function scaleStrokeForFlatten(
  element: XmlElement,
  matrix: AxisAlignedMatrix,
): void {
  const horizontal = Math.abs(matrix.a);
  const vertical = Math.abs(matrix.d);
  if (horizontal === 1 && vertical === 1) return;
  const style = element.getAttribute("style") ?? "";
  if (/\bstroke(?:-width)?\s*:/iu.test(style))
    throw new Error(
      "Flattening styled strokes requires CSS-aware stroke conversion",
    );
  const stroke = element.getAttribute("stroke");
  if (
    stroke === null ||
    stroke.trim().toLowerCase() === "none" ||
    element.getAttribute("vector-effect") === "non-scaling-stroke"
  )
    return;
  if (Math.abs(horizontal - vertical) > 1e-12)
    throw new Error("Flattening a non-uniformly scaled stroke is unsupported");
  setPositive(
    element,
    "stroke-width",
    horizontal * requiredNumber(element, "stroke-width", 1),
  );
}

function flattenRectangle(
  element: XmlElement,
  matrix: AxisAlignedMatrix,
): void {
  const x = requiredNumber(element, "x", 0);
  const y = requiredNumber(element, "y", 0);
  const width = requiredNumber(element, "width");
  const height = requiredNumber(element, "height");
  setFinite(
    element,
    "x",
    matrix.a >= 0 ? matrix.a * x + matrix.e : matrix.a * (x + width) + matrix.e,
  );
  setFinite(
    element,
    "y",
    matrix.d >= 0
      ? matrix.d * y + matrix.f
      : matrix.d * (y + height) + matrix.f,
  );
  setPositive(element, "width", Math.abs(matrix.a) * width);
  setPositive(element, "height", Math.abs(matrix.d) * height);
  scaleOptionalNonNegative(element, "rx", Math.abs(matrix.a));
  scaleOptionalNonNegative(element, "ry", Math.abs(matrix.d));
}

function flattenCircle(element: XmlElement, matrix: AxisAlignedMatrix): void {
  if (Math.abs(Math.abs(matrix.a) - Math.abs(matrix.d)) > 1e-12)
    throw new Error(
      "Flattening a non-uniformly scaled circle requires ellipse conversion",
    );
  setFinite(
    element,
    "cx",
    transformedNumber(element, "cx", matrix.a, matrix.e),
  );
  setFinite(
    element,
    "cy",
    transformedNumber(element, "cy", matrix.d, matrix.f),
  );
  setPositive(element, "r", Math.abs(matrix.a) * requiredNumber(element, "r"));
}

function flattenEllipse(element: XmlElement, matrix: AxisAlignedMatrix): void {
  setFinite(
    element,
    "cx",
    transformedNumber(element, "cx", matrix.a, matrix.e),
  );
  setFinite(
    element,
    "cy",
    transformedNumber(element, "cy", matrix.d, matrix.f),
  );
  setPositive(
    element,
    "rx",
    Math.abs(matrix.a) * requiredNumber(element, "rx"),
  );
  setPositive(
    element,
    "ry",
    Math.abs(matrix.d) * requiredNumber(element, "ry"),
  );
}

function flattenLine(element: XmlElement, matrix: AxisAlignedMatrix): void {
  setFinite(
    element,
    "x1",
    transformedNumber(element, "x1", matrix.a, matrix.e),
  );
  setFinite(
    element,
    "x2",
    transformedNumber(element, "x2", matrix.a, matrix.e),
  );
  setFinite(
    element,
    "y1",
    transformedNumber(element, "y1", matrix.d, matrix.f),
  );
  setFinite(
    element,
    "y2",
    transformedNumber(element, "y2", matrix.d, matrix.f),
  );
}

function flattenPoints(element: XmlElement, matrix: AxisAlignedMatrix): void {
  const raw = element.getAttribute("points");
  if (raw === null) throw new Error("Polygon points are missing");
  const numbers = parseTransformNumbers(raw);
  if (numbers.length < 4 || numbers.length % 2 !== 0)
    throw new Error("Polygon points are invalid");
  element.setAttribute(
    "points",
    Array.from({ length: numbers.length / 2 }, (_, index) => {
      const x = matrix.a * numbers[index * 2]! + matrix.e;
      const y = matrix.d * numbers[index * 2 + 1]! + matrix.f;
      return `${x},${y}`;
    }).join(" "),
  );
}

function requiredNumber(
  element: XmlElement,
  name: string,
  fallback?: number,
): number {
  const raw = element.getAttribute(name);
  if (raw === null && fallback !== undefined) return fallback;
  if (raw === null) throw new Error(`Element ${name} is missing`);
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`Element ${name} must be finite`);
  return value;
}

function transformedNumber(
  element: XmlElement,
  name: string,
  scale: number,
  offset: number,
): number {
  return scale * requiredNumber(element, name, 0) + offset;
}

function scaleOptionalNonNegative(
  element: XmlElement,
  name: string,
  scale: number,
): void {
  const raw = element.getAttribute(name);
  if (raw === null) return;
  setOptionalNonNegative(element, name, scale * requiredNumber(element, name));
}

function hasTransformedAncestor(element: XmlElement): boolean {
  for (
    let parent = parentElement(element);
    parent;
    parent = parentElement(parent)
  )
    if (parent.hasAttribute("transform")) return true;
  return false;
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
function isDescendant(element: XmlElement, ancestor: XmlElement): boolean {
  for (
    let current = parentElement(element);
    current;
    current = parentElement(current)
  )
    if (current === ancestor) return true;
  return false;
}
function isDescendantOfSelected(
  element: XmlElement,
  selected: ReadonlySet<XmlElement>,
): boolean {
  for (
    let current = parentElement(element);
    current;
    current = parentElement(current)
  )
    if (selected.has(current)) return true;
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
  if (style.classes !== undefined) {
    if (
      style.classes.length > 32 ||
      new Set(style.classes).size !== style.classes.length
    )
      throw new Error("classes must contain at most 32 unique CSS identifiers");
    for (const className of style.classes)
      if (!SAFE_CLASS.test(className)) throw new Error("class name is invalid");
    element.setAttribute("class", style.classes.join(" "));
  }
  if (style.display !== undefined)
    element.setAttribute("display", style.display);
  if (style.fill !== undefined) element.setAttribute("fill", paint(style.fill));
  if (style.fillOpacity !== undefined) {
    assertRange(style.fillOpacity, "fillOpacity", 0, 1);
    element.setAttribute("fill-opacity", String(style.fillOpacity));
  }
  if (style.fillRule !== undefined)
    element.setAttribute("fill-rule", style.fillRule);
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
  if (style.fontStyle !== undefined)
    element.setAttribute("font-style", style.fontStyle);
  if (style.fontWeight !== undefined)
    element.setAttribute(
      "font-weight",
      String(validFontWeight(style.fontWeight)),
    );
  if (style.letterSpacing !== undefined) {
    assertRange(style.letterSpacing, "letterSpacing", -10_000, 10_000);
    element.setAttribute("letter-spacing", String(style.letterSpacing));
  }
  if (style.locked !== undefined)
    element.setAttributeNS(
      "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
      "sodipodi:insensitive",
      String(style.locked),
    );
  if (style.stroke !== undefined)
    element.setAttribute("stroke", paint(style.stroke));
  if (style.strokeDasharray !== undefined) {
    if (style.strokeDasharray.length > 32)
      throw new Error("strokeDasharray may contain at most 32 values");
    for (const value of style.strokeDasharray)
      assertRange(value, "strokeDasharray", 0, 100_000);
    element.setAttribute("stroke-dasharray", style.strokeDasharray.join(" "));
  }
  if (style.strokeLineCap !== undefined)
    element.setAttribute("stroke-linecap", style.strokeLineCap);
  if (style.strokeLineJoin !== undefined)
    element.setAttribute("stroke-linejoin", style.strokeLineJoin);
  if (style.strokeMiterLimit !== undefined) {
    assertRange(style.strokeMiterLimit, "strokeMiterLimit", 1, 100_000);
    element.setAttribute("stroke-miterlimit", String(style.strokeMiterLimit));
  }
  if (style.strokeOpacity !== undefined) {
    assertRange(style.strokeOpacity, "strokeOpacity", 0, 1);
    element.setAttribute("stroke-opacity", String(style.strokeOpacity));
  }
  if (style.opacity !== undefined) {
    assertRange(style.opacity, "opacity", 0, 1);
    element.setAttribute("opacity", String(style.opacity));
  }
  if (style.strokeWidth !== undefined) {
    assertRange(style.strokeWidth, "strokeWidth", 0, Number.POSITIVE_INFINITY);
    element.setAttribute("stroke-width", String(style.strokeWidth));
  }
  if (style.paintOrder !== undefined)
    element.setAttribute("paint-order", style.paintOrder);
  if (style.textAnchor !== undefined)
    element.setAttribute("text-anchor", style.textAnchor);
  if (style.visibility !== undefined)
    element.setAttribute("visibility", style.visibility);
  if (style.wordSpacing !== undefined) {
    assertRange(style.wordSpacing, "wordSpacing", -10_000, 10_000);
    element.setAttribute("word-spacing", String(style.wordSpacing));
  }
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
function paint(value: string): string {
  if (value === "none") return value;
  if (!COLOR.test(value))
    throw new Error("Shape paint must be none or #rrggbb");
  return value.toLowerCase();
}
function validFontWeight(value: ShapeStyle["fontWeight"]): string | number {
  if (value === "normal" || value === "bold") return value;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 900 &&
    value % 100 === 0
  )
    return value;
  throw new Error("fontWeight must be normal, bold, or 100 through 900 by 100");
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
    /^data:image\/(?:bmp|gif|jpeg|png|tiff|webp|x-tga);base64,[A-Za-z0-9+/]+={0,2}$/iu.test(
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
  parseSvgPathData(value);
}
