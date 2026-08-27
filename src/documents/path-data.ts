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
  if (
    segment.command !== "M" &&
    segment.command !== "L" &&
    segment.command !== "T"
  )
    throw new Error(
      "Node move currently supports absolute moveto, lineto, and smooth quadratic endpoints",
    );
  segments[index] = { command: segment.command, values: [point.x, point.y] };
  return serializeSvgPathData(segments);
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
