import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const SODIPODI_NAMESPACE = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type SvgGuide = {
  id: string;
  label?: string | undefined;
  orientation: "horizontal" | "vertical";
  position: readonly [number, number];
};
export type SvgGuideSpec = SvgGuide;
export type SvgGuidePatch = {
  label?: string | undefined;
  orientation?: "horizontal" | "vertical" | undefined;
  position?: readonly [number, number] | undefined;
};
export type SvgGrid = {
  enabled: boolean;
  id: string;
  origin: readonly [number, number];
  spacing: readonly [number, number];
  type: "xygrid";
  visible: boolean;
};
export type SvgGridSpec = SvgGrid;
export type SvgGridPatch = {
  enabled?: boolean | undefined;
  origin?: readonly [number, number] | undefined;
  spacing?: readonly [number, number] | undefined;
  visible?: boolean | undefined;
};

/** Reads document-local Inkscape guides and grids, never global preferences. */
export function inspectSvgGuidesAndGrids(source: string): {
  grids: readonly SvgGrid[];
  guides: readonly SvgGuide[];
} {
  const document = parseDocument(source);
  return {
    grids: gridElements(document)
      .map(readGrid)
      .sort((left, right) => left.id.localeCompare(right.id)),
    guides: guideElements(document)
      .map(readGuide)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function createSvgGuide(source: string, spec: SvgGuideSpec): string {
  validateGuideSpec(spec);
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Guide ID already exists");
  const guide = document.createElementNS(SODIPODI_NAMESPACE, "sodipodi:guide");
  guide.setAttribute("id", spec.id);
  writeGuide(guide, spec);
  namedView(document).appendChild(guide);
  return serialize(document);
}

export function updateSvgGuide(
  source: string,
  id: string,
  patch: SvgGuidePatch,
): string {
  if (!SAFE_ID.test(id)) throw new Error("Guide ID is invalid");
  validateGuidePatch(patch);
  const document = parseDocument(source);
  const guide = requireGuide(document, id);
  writeGuide(guide, patch);
  return serialize(document);
}

export function deleteSvgGuide(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Guide ID is invalid");
  const document = parseDocument(source);
  const guide = requireGuide(document, id);
  guide.parentNode?.removeChild(guide);
  return serialize(document);
}

export function createSvgGrid(source: string, spec: SvgGridSpec): string {
  validateGridSpec(spec);
  const document = parseDocument(source);
  if (findById(document, spec.id)) throw new Error("Grid ID already exists");
  const grid = document.createElementNS(INKSCAPE_NAMESPACE, "inkscape:grid");
  grid.setAttribute("id", spec.id);
  grid.setAttribute("type", "xygrid");
  writeGrid(grid, spec);
  namedView(document).appendChild(grid);
  return serialize(document);
}

export function updateSvgGrid(
  source: string,
  id: string,
  patch: SvgGridPatch,
): string {
  if (!SAFE_ID.test(id)) throw new Error("Grid ID is invalid");
  validateGridPatch(patch);
  const document = parseDocument(source);
  const grid = requireGrid(document, id);
  writeGrid(grid, patch);
  return serialize(document);
}

export function deleteSvgGrid(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Grid ID is invalid");
  const document = parseDocument(source);
  const grid = requireGrid(document, id);
  grid.parentNode?.removeChild(grid);
  return serialize(document);
}

function validateGuideSpec(spec: SvgGuideSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Guide ID is invalid");
  validateGuidePatch(spec);
  if (spec.orientation === undefined || spec.position === undefined)
    throw new Error("Guide orientation and position are required");
}
function validateGuidePatch(patch: SvgGuidePatch): void {
  if (
    patch.orientation !== undefined &&
    !["horizontal", "vertical"].includes(patch.orientation)
  )
    throw new Error("Guide orientation must be horizontal or vertical");
  if (patch.position !== undefined && !isFinitePair(patch.position))
    throw new Error("Guide position must contain two finite coordinates");
  if (
    patch.label !== undefined &&
    (patch.label.length > 256 || hasControlCharacters(patch.label))
  )
    throw new Error("Guide label is invalid");
}
function validateGridSpec(spec: SvgGridSpec): void {
  if (!SAFE_ID.test(spec.id)) throw new Error("Grid ID is invalid");
  if (spec.type !== "xygrid") throw new Error("Only xygrid is supported");
  validateGridPatch(spec);
  if (spec.spacing === undefined || spec.origin === undefined)
    throw new Error("Grid spacing and origin are required");
}
function validateGridPatch(patch: SvgGridPatch): void {
  if (
    patch.spacing !== undefined &&
    (!isFinitePair(patch.spacing) ||
      patch.spacing[0] <= 0 ||
      patch.spacing[1] <= 0)
  )
    throw new Error(
      "Grid spacing must contain two finite positive coordinates",
    );
  if (patch.origin !== undefined && !isFinitePair(patch.origin))
    throw new Error("Grid origin must contain two finite coordinates");
}
function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing guides or grids");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}
function namedView(document: XmlDocument): XmlElement {
  const existing = document.getElementsByTagNameNS(
    SODIPODI_NAMESPACE,
    "namedview",
  )[0];
  if (existing) return existing;
  const root = document.documentElement!;
  root.setAttribute("xmlns:inkscape", INKSCAPE_NAMESPACE);
  root.setAttribute("xmlns:sodipodi", SODIPODI_NAMESPACE);
  const view = document.createElementNS(
    SODIPODI_NAMESPACE,
    "sodipodi:namedview",
  );
  view.setAttribute("id", "namedview1");
  root.insertBefore(view, root.firstChild);
  return view;
}
function guideElements(document: XmlDocument): XmlElement[] {
  return Array.from(
    document.getElementsByTagNameNS(SODIPODI_NAMESPACE, "guide"),
  );
}
function gridElements(document: XmlDocument): XmlElement[] {
  return Array.from(
    document.getElementsByTagNameNS(INKSCAPE_NAMESPACE, "grid"),
  );
}
function requireGuide(document: XmlDocument, id: string): XmlElement {
  const guide = guideElements(document).find(
    (element) => element.getAttribute("id") === id,
  );
  if (!guide) throw new Error("Guide ID does not exist");
  return guide;
}
function requireGrid(document: XmlDocument, id: string): XmlElement {
  const grid = gridElements(document).find(
    (element) => element.getAttribute("id") === id,
  );
  if (!grid || grid.getAttribute("type") !== "xygrid")
    throw new Error("Grid ID does not name an xygrid");
  return grid;
}
function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}
function readGuide(guide: XmlElement): SvgGuide {
  const id = guide.getAttribute("id");
  if (!id || !SAFE_ID.test(id)) throw new Error("Guide ID is invalid");
  const orientation = guide.getAttribute("orientation");
  const position = parsePair(
    guide.getAttribute("position"),
    "Guide position",
    false,
  );
  const label = guide.getAttributeNS(INKSCAPE_NAMESPACE, "label") ?? undefined;
  if (orientation === "1,0")
    return {
      id,
      orientation: "vertical",
      position,
      ...(label === undefined ? {} : { label }),
    };
  if (orientation === "0,1")
    return {
      id,
      orientation: "horizontal",
      position,
      ...(label === undefined ? {} : { label }),
    };
  throw new Error("Guide orientation is invalid");
}
function writeGuide(
  guide: XmlElement,
  value: SvgGuideSpec | SvgGuidePatch,
): void {
  if (value.position !== undefined)
    guide.setAttribute("position", value.position.join(","));
  if (value.orientation !== undefined)
    guide.setAttribute(
      "orientation",
      value.orientation === "vertical" ? "1,0" : "0,1",
    );
  if ("label" in value && value.label !== undefined)
    guide.setAttributeNS(INKSCAPE_NAMESPACE, "inkscape:label", value.label);
}
function readGrid(grid: XmlElement): SvgGrid {
  const id = grid.getAttribute("id");
  if (!id || !SAFE_ID.test(id)) throw new Error("Grid ID is invalid");
  if (grid.getAttribute("type") !== "xygrid")
    throw new Error("Only xygrid is supported");
  return {
    enabled: parseBoolean(grid.getAttribute("enabled"), true),
    id,
    origin: [readFinite(grid, "originx", 0), readFinite(grid, "originy", 0)],
    spacing: [
      readPositive(grid, "spacingx", 1),
      readPositive(grid, "spacingy", 1),
    ],
    type: "xygrid",
    visible: parseBoolean(grid.getAttribute("visible"), true),
  };
}
function writeGrid(grid: XmlElement, value: SvgGridSpec | SvgGridPatch): void {
  if (value.spacing !== undefined) {
    grid.setAttribute("spacingx", String(value.spacing[0]));
    grid.setAttribute("spacingy", String(value.spacing[1]));
  }
  if (value.origin !== undefined) {
    grid.setAttribute("originx", String(value.origin[0]));
    grid.setAttribute("originy", String(value.origin[1]));
  }
  if (value.visible !== undefined)
    grid.setAttribute("visible", String(value.visible));
  if (value.enabled !== undefined)
    grid.setAttribute("enabled", String(value.enabled));
}
function parsePair(
  raw: string | null,
  name: string,
  positive: boolean,
): readonly [number, number] {
  const values = (raw ?? "").split(",").map(Number);
  if (
    values.length !== 2 ||
    !isFinitePair(values) ||
    (positive && (values[0]! <= 0 || values[1]! <= 0))
  )
    throw new Error(`${name} is invalid`);
  return [values[0]!, values[1]!];
}
function isFinitePair(
  values: readonly number[],
): values is readonly [number, number] {
  return values.length === 2 && values.every(Number.isFinite);
}
function readFinite(
  element: XmlElement,
  name: string,
  fallback: number,
): number {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Grid ${name} must be finite`);
  return value;
}
function readPositive(
  element: XmlElement,
  name: string,
  fallback: number,
): number {
  const value = readFinite(element, name, fallback);
  if (value <= 0) throw new Error(`Grid ${name} must be positive`);
  return value;
}
function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("Grid visibility/enabled value is invalid");
}
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127;
  });
}
function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
