import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { inspectSvgSettings } from "./basic.js";
import { sanitizeSvg } from "../svg/index.js";

type Matrix = readonly [number, number, number, number, number, number];

export type SvgImageDpiInspection = {
  images: readonly {
    dpiRange?: { max: number; min: number };
    dpiX?: number;
    dpiY?: number;
    fidelity: "exact-axis-aligned" | "range-from-transform" | "unavailable";
    id?: string;
    warnings: readonly string[];
  }[];
};

/** Inspects embedded PNG effective DPI. Linked files are deliberately not read. */
export function inspectSvgImageDpi(source: string): SvgImageDpiInspection {
  const document = parseDocument(source);
  const settings = inspectSvgSettings(source);
  const widthMm = physicalMillimeters(settings.width);
  const heightMm = physicalMillimeters(settings.height);
  if (widthMm === undefined || heightMm === undefined)
    return {
      images: elements(document, "image").map((image) =>
        unavailable(image, "PAGE_PHYSICAL_SIZE_UNAVAILABLE"),
      ),
    };
  const unitX = widthMm / settings.viewBox.width;
  const unitY = heightMm / settings.viewBox.height;
  return {
    images: elements(document, "image").map((image) =>
      inspectImage(image, unitX, unitY),
    ),
  };
}

function inspectImage(image: XmlElement, unitX: number, unitY: number) {
  const id = image.getAttribute("id") ?? undefined;
  const intrinsic = embeddedPngSize(
    image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "",
  );
  const width = userLength(image.getAttribute("width"), unitX);
  const height = userLength(image.getAttribute("height"), unitY);
  if (intrinsic === undefined)
    return unavailable(image, "INTRINSIC_RASTER_SIZE_UNAVAILABLE");
  if (width === undefined || height === undefined)
    return unavailable(image, "DISPLAY_DIMENSIONS_UNAVAILABLE");
  const matrix = accumulatedMatrix(image);
  const physical: Matrix = [
    matrix[0] * unitX,
    matrix[1] * unitY,
    matrix[2] * unitX,
    matrix[3] * unitY,
    0,
    0,
  ];
  const displayWidthMm = width * Math.hypot(physical[0], physical[1]);
  const displayHeightMm = height * Math.hypot(physical[2], physical[3]);
  if (displayWidthMm <= 0 || displayHeightMm <= 0)
    return unavailable(image, "SINGULAR_OR_ZERO_TRANSFORM");
  const dpiX = (intrinsic.width * 25.4) / displayWidthMm;
  const dpiY = (intrinsic.height * 25.4) / displayHeightMm;
  const [minimum, maximum] = singularValues(physical);
  const normalizedMinimum = minimum / Math.sqrt(unitX * unitY);
  const normalizedMaximum = maximum / Math.sqrt(unitX * unitY);
  const transformed =
    Math.abs(physical[1]) > 1e-9 || Math.abs(physical[2]) > 1e-9;
  return {
    ...(id === undefined ? {} : { id }),
    dpiX,
    dpiY,
    ...(transformed
      ? {
          dpiRange: {
            max: Math.max(dpiX, dpiY) / normalizedMinimum,
            min: Math.min(dpiX, dpiY) / normalizedMaximum,
          },
        }
      : {}),
    fidelity: transformed
      ? ("range-from-transform" as const)
      : ("exact-axis-aligned" as const),
    warnings: transformed ? ["ROTATION_OR_SKEW_REPORTED_AS_DPI_RANGE"] : [],
  };
}

function unavailable(image: XmlElement, warning: string) {
  const id = image.getAttribute("id") ?? undefined;
  return {
    ...(id === undefined ? {} : { id }),
    fidelity: "unavailable" as const,
    warnings: [warning],
  };
}

function userLength(value: string | null, unitsMm: number): number | undefined {
  if (value === null) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|px)?$/u.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const unit = match[2];
  if (unit === undefined) return number;
  return millimeters(number, unit) / unitsMm;
}

function physicalMillimeters(value: string): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|px)$/u.exec(
    value.trim(),
  );
  if (!match) return undefined;
  return millimeters(Number(match[1]), match[2]!);
}

function millimeters(value: number, unit: string): number {
  return {
    cm: value * 10,
    in: value * 25.4,
    mm: value,
    pc: (value * 25.4) / 6,
    pt: (value * 25.4) / 72,
    px: (value * 25.4) / 96,
  }[unit]!;
}

function accumulatedMatrix(element: XmlElement): Matrix {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const ancestors: XmlElement[] = [];
  for (let current: XmlElement | null = element; current;) {
    ancestors.push(current);
    current =
      current.parentNode?.nodeType === 1
        ? (current.parentNode as XmlElement)
        : null;
  }
  for (const current of ancestors.reverse())
    matrix = multiply(
      matrix,
      parseTransform(current.getAttribute("transform") ?? ""),
    );
  return matrix;
}

function parseTransform(value: string): Matrix {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  for (const match of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/gu)) {
    const values = (match[2] ?? "")
      .trim()
      .split(/[ ,]+/u)
      .filter(Boolean)
      .map(Number);
    if (values.some((number) => !Number.isFinite(number)))
      return [0, 0, 0, 0, 0, 0];
    const kind = match[1]!.toLowerCase();
    const next: Matrix =
      kind === "matrix" && values.length === 6
        ? [
            values[0]!,
            values[1]!,
            values[2]!,
            values[3]!,
            values[4]!,
            values[5]!,
          ]
        : kind === "translate" && (values.length === 1 || values.length === 2)
          ? ([1, 0, 0, 1, values[0]!, values[1] ?? 0] as Matrix)
          : kind === "scale" && (values.length === 1 || values.length === 2)
            ? ([values[0]!, 0, 0, values[1] ?? values[0]!, 0, 0] as Matrix)
            : kind === "rotate" && (values.length === 1 || values.length === 3)
              ? rotate(values)
              : kind === "skewx" && values.length === 1
                ? ([
                    1,
                    0,
                    Math.tan((values[0]! * Math.PI) / 180),
                    1,
                    0,
                    0,
                  ] as Matrix)
                : kind === "skewy" && values.length === 1
                  ? ([
                      1,
                      Math.tan((values[0]! * Math.PI) / 180),
                      0,
                      1,
                      0,
                      0,
                    ] as Matrix)
                  : ([0, 0, 0, 0, 0, 0] as Matrix);
    matrix = multiply(matrix, next);
  }
  return matrix;
}

function rotate(values: readonly number[]): Matrix {
  const angle = (values[0]! * Math.PI) / 180;
  const matrix: Matrix = [
    Math.cos(angle),
    Math.sin(angle),
    -Math.sin(angle),
    Math.cos(angle),
    0,
    0,
  ];
  if (values.length === 1) return matrix;
  return multiply(multiply([1, 0, 0, 1, values[1]!, values[2]!], matrix), [
    1,
    0,
    0,
    1,
    -values[1]!,
    -values[2]!,
  ]);
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function singularValues(matrix: Matrix): [number, number] {
  const trace =
    matrix[0] ** 2 + matrix[1] ** 2 + matrix[2] ** 2 + matrix[3] ** 2;
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const root = Math.sqrt(Math.max(0, trace ** 2 - 4 * determinant ** 2));
  return [
    Math.sqrt(Math.max(0, (trace - root) / 2)),
    Math.sqrt((trace + root) / 2),
  ];
}

function embeddedPngSize(
  href: string,
): { height: number; width: number } | undefined {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/iu.exec(href);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1]!.slice(0, 128), "base64");
  if (
    bytes.length < 24 ||
    !bytes.subarray(1, 4).equals(Buffer.from("PNG")) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function elements(document: XmlDocument, name: string): XmlElement[] {
  return Array.from(document.getElementsByTagName(name));
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before inspecting image DPI");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}
