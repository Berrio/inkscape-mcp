export type SvgPathSegment = {
  command:
    | "A"
    | "a"
    | "C"
    | "c"
    | "H"
    | "h"
    | "L"
    | "l"
    | "M"
    | "m"
    | "Q"
    | "q"
    | "S"
    | "s"
    | "T"
    | "t"
    | "V"
    | "v"
    | "Z"
    | "z";
  values: readonly number[];
};

const COMMAND_ARITY: Readonly<Record<SvgPathSegment["command"], number>> = {
  A: 7,
  a: 7,
  C: 6,
  c: 6,
  H: 1,
  h: 1,
  L: 2,
  l: 2,
  M: 2,
  m: 2,
  Q: 4,
  q: 4,
  S: 4,
  s: 4,
  T: 2,
  t: 2,
  V: 1,
  v: 1,
  Z: 0,
  z: 0,
};
const TOKEN =
  /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/gu;
const COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/u;

/** Parses bounded SVG path data into a mutable command stream. */
export function parseSvgPathData(value: string): SvgPathSegment[] {
  if (value.length < 1 || value.length > 100_000)
    throw new Error("Path data is invalid or too long");
  const tokens = value.match(TOKEN);
  if (!tokens || value.replace(/[\s,]/gu, "") !== tokens.join(""))
    throw new Error("Path data has invalid syntax");
  if (tokens[0] !== "M" && tokens[0] !== "m")
    throw new Error("Path data must start with a moveto command");
  const segments: SvgPathSegment[] = [];
  let command: SvgPathSegment["command"] | undefined;
  let firstPairForCommand = false;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (COMMAND.test(token)) {
      command = token as SvgPathSegment["command"];
      firstPairForCommand = true;
      index += 1;
      if (COMMAND_ARITY[command] === 0) {
        segments.push({ command, values: [] });
        command = undefined;
        continue;
      }
    }
    if (command === undefined)
      throw new Error("Path data must include a command before coordinates");
    const arity = COMMAND_ARITY[command];
    if (index + arity > tokens.length)
      throw new Error("Path command is incomplete");
    const values = tokens.slice(index, index + arity).map(Number);
    validatePathValues(command, values);
    segments.push({
      command:
        (command === "M" || command === "m") && !firstPairForCommand
          ? command === "M"
            ? "L"
            : "l"
          : command,
      values,
    });
    firstPairForCommand = false;
    index += arity;
  }
  if (segments.length > 10_000) throw new Error("Path has too many segments");
  return segments;
}

/** Stable compact serialization for a previously validated AST. */
export function serializeSvgPathData(
  segments: readonly SvgPathSegment[],
): string {
  if (segments.length < 1 || segments.length > 10_000)
    throw new Error("Path must contain between one and 10,000 segments");
  if (segments[0]!.command !== "M" && segments[0]!.command !== "m")
    throw new Error("Path data must start with a moveto command");
  return segments
    .map((segment) => {
      const arity = COMMAND_ARITY[segment.command];
      if (segment.values.length !== arity)
        throw new Error("Path segment arity is invalid");
      validatePathValues(segment.command, segment.values);
      return segment.values.length === 0
        ? segment.command
        : `${segment.command} ${segment.values.join(" ")}`;
    })
    .join(" ");
}

/** Splits a path command stream at each explicit SVG moveto. */
export function splitSvgPathSubpaths(
  segments: readonly SvgPathSegment[],
): SvgPathSegment[][] {
  const result: SvgPathSegment[][] = [];
  let current: SvgPathSegment[] | undefined;
  for (const segment of segments) {
    if (segment.command === "M" || segment.command === "m") {
      current = [segment];
      result.push(current);
      continue;
    }
    if (current === undefined)
      throw new Error("Path data must start with a moveto command");
    current.push(segment);
  }
  if (result.length === 0)
    throw new Error("Path must contain a moveto command");
  return result;
}

/** Reverses simple line-only subpaths without changing their fill closure. */
export function reverseLinearSvgPathData(value: string): string {
  const subpaths = splitSvgPathSubpaths(parseSvgPathData(value));
  return subpaths
    .map((subpath) => serializeReversedLinearSubpath(subpath))
    .join(" ");
}

/** Moves one explicit absolute node without accepting raw path data from callers. */
export function moveAbsoluteSvgPathNode(
  value: string,
  index: number,
  point: { x: number; y: number },
): string {
  if (!Number.isInteger(index) || index < 0)
    throw new Error("Path node index is invalid");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error("Path node coordinates must be finite");
  const segments = parseSvgPathData(value);
  const segment = segments[index];
  if (!segment) throw new Error("Path node index does not exist");
  const endpointOffset = absoluteEndpointOffset(segment.command);
  if (endpointOffset === undefined)
    throw new Error(
      "Node move currently supports absolute moveto, lineto, quadratic, cubic, smooth, and arc endpoints",
    );
  const values = [...segment.values];
  values[endpointOffset] = point.x;
  values[endpointOffset + 1] = point.y;
  segments[index] = { command: segment.command, values };
  return serializeSvgPathData(segments);
}

export function editAbsoluteLinearSvgPathNode(
  value: string,
  request:
    | { action: "delete"; index: number }
    | { action: "insert"; index: number; point: { x: number; y: number } }
    | { action: "close_subpath"; index: number }
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
): string {
  const segments = parseSvgPathData(value);
  if (!Number.isInteger(request.index) || request.index < 0)
    throw new Error("Path node index is invalid");
  if (request.action === "insert") {
    if (
      !Number.isFinite(request.point.x) ||
      !Number.isFinite(request.point.y) ||
      request.index < 1 ||
      request.index > segments.length
    )
      throw new Error("Path node insertion is invalid");
    segments.splice(request.index, 0, {
      command: "L",
      values: [request.point.x, request.point.y],
    });
    return serializeSvgPathData(segments);
  }
  if (request.action === "close_subpath" || request.action === "open_subpath") {
    const subpath = locateSubpath(segments, request.index);
    if (request.action === "close_subpath") {
      if (subpath.closed) throw new Error("Path subpath is already closed");
      if (subpath.end - subpath.start < 2)
        throw new Error("Path subpath needs a drawable segment before closing");
      segments.splice(subpath.end, 0, { command: "Z", values: [] });
    } else {
      if (!subpath.closed) throw new Error("Path subpath is already open");
      segments.splice(subpath.end - 1, 1);
    }
    return serializeSvgPathData(segments);
  }
  if (request.action === "set_quadratic_handle") {
    const segment = requireAbsoluteSegment(segments, request.index, "Q");
    validatePoint(request.control, "Quadratic handle");
    segments[request.index] = {
      command: "Q",
      values: [
        request.control.x,
        request.control.y,
        segment.values[2]!,
        segment.values[3]!,
      ],
    };
    return serializeSvgPathData(segments);
  }
  if (request.action === "set_cubic_handles") {
    const segment = requireAbsoluteSegment(segments, request.index, "C");
    validatePoint(request.control1, "First cubic handle");
    validatePoint(request.control2, "Second cubic handle");
    segments[request.index] = {
      command: "C",
      values: [
        request.control1.x,
        request.control1.y,
        request.control2.x,
        request.control2.y,
        segment.values[4]!,
        segment.values[5]!,
      ],
    };
    return serializeSvgPathData(segments);
  }
  if (request.action === "set_arc_parameters") {
    if (
      !Number.isFinite(request.rx) ||
      !Number.isFinite(request.ry) ||
      !Number.isFinite(request.rotation) ||
      request.rx < 0 ||
      request.ry < 0
    )
      throw new Error("Arc parameters are invalid");
    const segment = requireAbsoluteSegment(segments, request.index, "A");
    segments[request.index] = {
      command: "A",
      values: [
        request.rx,
        request.ry,
        request.rotation,
        request.largeArc ? 1 : 0,
        request.sweep ? 1 : 0,
        segment.values[5]!,
        segment.values[6]!,
      ],
    };
    return serializeSvgPathData(segments);
  }
  if (request.index === 0)
    throw new Error("The initial moveto cannot be edited");
  const segment = segments[request.index];
  if (!segment || (segment.command !== "L" && segment.command !== "T"))
    throw new Error(
      "Node editing currently supports absolute lineto and smooth quadratic segments",
    );
  if (request.action === "delete") {
    segments.splice(request.index, 1);
  } else {
    segments[request.index] = {
      command: request.command,
      values: segment.values,
    };
  }
  return serializeSvgPathData(segments);
}

function absoluteEndpointOffset(
  command: SvgPathSegment["command"],
): number | undefined {
  switch (command) {
    case "M":
    case "L":
    case "T":
      return 0;
    case "C":
      return 4;
    case "Q":
    case "S":
      return 2;
    case "A":
      return 5;
    default:
      return undefined;
  }
}

function locateSubpath(
  segments: readonly SvgPathSegment[],
  index: number,
): { closed: boolean; end: number; start: number } {
  if (index >= segments.length)
    throw new Error("Path node index does not exist");
  let start = index;
  while (start >= 0 && segments[start]?.command !== "M") start -= 1;
  if (start < 0)
    throw new Error("Path data must start with an absolute moveto");
  let end = start + 1;
  while (end < segments.length && segments[end]?.command !== "M") end += 1;
  const tail = segments[end - 1]?.command;
  return { closed: tail === "Z" || tail === "z", end, start };
}

function requireAbsoluteSegment(
  segments: readonly SvgPathSegment[],
  index: number,
  command: "A" | "C" | "Q",
): SvgPathSegment {
  const segment = segments[index];
  if (!segment || segment.command !== command)
    throw new Error(`Path segment must be an absolute ${command} command`);
  return segment;
}

function validatePoint(point: { x: number; y: number }, name: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error(`${name} coordinates must be finite`);
}

function serializeReversedLinearSubpath(
  subpath: readonly SvgPathSegment[],
): string {
  if (subpath[0]?.command === "m")
    throw new Error(
      "Path reverse currently requires absolute moveto commands for each subpath",
    );
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let closed = false;
  const points: { x: number; y: number }[] = [];
  for (const segment of subpath) {
    switch (segment.command) {
      case "M":
        current = { x: segment.values[0]!, y: segment.values[1]! };
        start = current;
        points.push(current);
        break;
      case "m":
        throw new Error(
          "Path reverse currently requires absolute moveto commands for each subpath",
        );
      case "L":
        current = { x: segment.values[0]!, y: segment.values[1]! };
        points.push(current);
        break;
      case "l":
        current = {
          x: current.x + segment.values[0]!,
          y: current.y + segment.values[1]!,
        };
        points.push(current);
        break;
      case "H":
        current = { x: segment.values[0]!, y: current.y };
        points.push(current);
        break;
      case "h":
        current = { x: current.x + segment.values[0]!, y: current.y };
        points.push(current);
        break;
      case "V":
        current = { x: current.x, y: segment.values[0]! };
        points.push(current);
        break;
      case "v":
        current = { x: current.x, y: current.y + segment.values[0]! };
        points.push(current);
        break;
      case "Z":
      case "z":
        current = start;
        closed = true;
        break;
      default:
        throw new Error(
          "Path reverse currently supports only moveto, lineto, horizontal, vertical and close commands",
        );
    }
  }
  const ordered = closed
    ? [points[0]!, ...points.slice(1).toReversed()]
    : [...points].toReversed();
  const head = ordered[0];
  if (!head) throw new Error("Path subpath is empty");
  return [
    `M ${head.x} ${head.y}`,
    ...ordered.slice(1).map((point) => `L ${point.x} ${point.y}`),
    ...(closed ? ["Z"] : []),
  ].join(" ");
}

function validatePathValues(
  command: SvgPathSegment["command"],
  values: readonly number[],
): void {
  if (values.some((item) => !Number.isFinite(item)))
    throw new Error("Path coordinate must be finite");
  if (
    (command === "A" || command === "a") &&
    (values[0]! < 0 || values[1]! < 0)
  )
    throw new Error("Path arc radii must be non-negative");
  if (
    (command === "A" || command === "a") &&
    ((values[3] !== 0 && values[3] !== 1) ||
      (values[4] !== 0 && values[4] !== 1))
  )
    throw new Error("Path arc flags must be zero or one");
}
