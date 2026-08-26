import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const SODIPODI_NAMESPACE = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const MAX_DETAIL_LIMIT = 1_000;
const KNOWN_NAMESPACES = new Set([
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/XML/1998/namespace",
  INKSCAPE_NAMESPACE,
  SODIPODI_NAMESPACE,
]);

export type DocumentInventory = {
  definitions: {
    filters: readonly { id: string; primitiveCount: number }[];
    gradients: readonly {
      id: string;
      kind: "linear" | "radial";
      stopCount: number;
    }[];
    patterns: readonly { height?: string; id: string; width?: string }[];
  };
  duplicateIds: readonly string[];
  elementCount: number;
  externalResourceCount: number;
  fontFamilies: readonly string[];
  fontWarnings: readonly ["FONT_RESOLUTION_UNAVAILABLE"];
  fontResolution: "unavailable";
  images: readonly {
    display: { height?: string; width?: string };
    intrinsic: {
      height?: number;
      status: "available" | "unavailable";
      width?: number;
    };
    kind: "embedded" | "external" | "linked";
  }[];
  ids: readonly string[];
  layers: readonly {
    id: string;
    label: string;
    locked: boolean;
    visibility: "hidden" | "visible";
  }[];
  namespaces: readonly string[];
  nextOffset?: number;
  offset: number;
  paintUsage: {
    fills: number;
    filters: number;
    gradients: number;
    opacities: number;
    patterns: number;
    strokes: number;
  };
  typeCounts: Readonly<Record<string, number>>;
  totalElementCount: number;
  truncated: boolean;
  unknownNamespaces: readonly string[];
  unresolvedReferences: readonly string[];
};

export type InventoryOptions = {
  detailLimit: number;
  kinds?: readonly string[] | undefined;
  offset?: number | undefined;
};

export function inspectSvgInventory(
  source: string,
  options: number | InventoryOptions = 100,
): DocumentInventory {
  const { detailLimit, kinds, offset } = normalizeOptions(options);
  // Validates malformed XML, DTD/entity use, document size and element limits
  // before the read-only raw DOM walk needed to preserve reference information.
  sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const root = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  ).documentElement;
  if (!root || root.localName !== "svg") throw new Error("SVG root is missing");
  const allElements = [...walk(root)];
  const selected =
    kinds === undefined
      ? allElements
      : allElements.filter((element) =>
          kinds.includes(element.localName ?? ""),
        );
  const elements = selected.slice(offset, offset + detailLimit);
  const pageElements = new Set(elements);
  const definitionKinds = new Map(
    allElements.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : ([[id, element.localName ?? ""]] as const);
    }),
  );
  const documentIds = new Set(
    allElements.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [id];
    }),
  );
  const typeCounts: Record<string, number> = {};
  const ids = new Set<string>();
  const inspectedIds: string[] = [];
  const duplicateIds = new Set<string>();
  const references = new Set<string>();
  const namespaces = new Set<string>();
  const layers: DocumentInventory["layers"][number][] = [];
  const images: DocumentInventory["images"][number][] = [];
  const definitions: {
    filters: { id: string; primitiveCount: number }[];
    gradients: { id: string; kind: "linear" | "radial"; stopCount: number }[];
    patterns: { height?: string; id: string; width?: string }[];
  } = {
    filters: [],
    gradients: [],
    patterns: [],
  };
  const fontFamilies = new Set<string>();
  const paintUsage: DocumentInventory["paintUsage"] = {
    fills: 0,
    filters: 0,
    gradients: 0,
    opacities: 0,
    patterns: 0,
    strokes: 0,
  };
  const elementCount = selected.length;
  let externalResourceCount = 0;
  let truncated = false;
  for (const element of selected) {
    const name = element.localName ?? "unknown";
    typeCounts[name] = (typeCounts[name] ?? 0) + 1;
    const id = element.getAttribute("id");
    const style = parseInlineStyle(element.getAttribute("style") ?? "");
    const fill = element.getAttribute("fill") ?? style.fill;
    const stroke = element.getAttribute("stroke") ?? style.stroke;
    const filter = element.getAttribute("filter") ?? style.filter;
    const opacity = element.getAttribute("opacity") ?? style.opacity;
    const fontFamily =
      element.getAttribute("font-family") ?? style["font-family"];
    if (fontFamily) {
      for (const family of fontFamily.split(",")) {
        const normalized = family.trim().replace(/^['"]|['"]$/gu, "");
        if (normalized) fontFamilies.add(normalized);
      }
    }
    if (name === "style")
      collectFontFamilies(element.textContent ?? "", fontFamilies);
    if (fill !== undefined) {
      paintUsage.fills += 1;
      if (
        isPaintReference(fill, definitionKinds, [
          "linearGradient",
          "radialGradient",
        ])
      )
        paintUsage.gradients += 1;
      if (isPaintReference(fill, definitionKinds, ["pattern"]))
        paintUsage.patterns += 1;
    }
    if (stroke !== undefined) {
      paintUsage.strokes += 1;
      if (
        isPaintReference(stroke, definitionKinds, [
          "linearGradient",
          "radialGradient",
        ])
      )
        paintUsage.gradients += 1;
      if (isPaintReference(stroke, definitionKinds, ["pattern"]))
        paintUsage.patterns += 1;
    }
    if (filter !== undefined && filter !== "none") paintUsage.filters += 1;
    if (opacity !== undefined) paintUsage.opacities += 1;
    if (id) {
      if (ids.has(id)) duplicateIds.add(id);
      ids.add(id);
    }
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      if (attribute.name === "xmlns" || attribute.prefix === "xmlns")
        namespaces.add(attribute.value);
      if (attribute.name === "href" || attribute.name === "xlink:href") {
        const target = attribute.value.trim();
        if (target.startsWith("#")) references.add(target.slice(1));
        else if (isExternalReference(target)) externalResourceCount += 1;
      }
    }
    if (!pageElements.has(element)) continue;
    if (id) inspectedIds.push(id);
    if (
      name === "g" &&
      element.getAttributeNS(INKSCAPE_NAMESPACE, "groupmode") === "layer"
    ) {
      if (layers.length >= detailLimit) truncated = true;
      else {
        layers.push({
          id: id ?? "",
          label:
            element.getAttributeNS(INKSCAPE_NAMESPACE, "label") ?? id ?? "",
          locked:
            element.getAttributeNS(SODIPODI_NAMESPACE, "insensitive") ===
            "true",
          visibility: isHidden(element) ? "hidden" : "visible",
        });
      }
    }
    if (name === "image") {
      const href =
        element.getAttribute("href") ??
        element.getAttribute("xlink:href") ??
        "";
      if (images.length >= detailLimit) truncated = true;
      else images.push(imageSummary(element, href));
    }
    collectDefinition(element, definitions, detailLimit, () => {
      truncated = true;
    });
  }
  return {
    definitions,
    duplicateIds: [...duplicateIds].sort(),
    elementCount,
    externalResourceCount,
    fontFamilies: [...fontFamilies].sort(),
    fontWarnings: ["FONT_RESOLUTION_UNAVAILABLE"],
    fontResolution: "unavailable",
    images,
    ids: inspectedIds,
    layers,
    namespaces: [...namespaces].sort(),
    ...(offset + elements.length < selected.length
      ? { nextOffset: offset + elements.length }
      : {}),
    offset,
    paintUsage,
    typeCounts,
    totalElementCount: selected.length,
    truncated: truncated || offset + elements.length < selected.length,
    unknownNamespaces: [...namespaces]
      .filter((namespace) => !KNOWN_NAMESPACES.has(namespace))
      .sort(),
    unresolvedReferences: [...references]
      .filter((id) => !documentIds.has(id))
      .sort(),
  };
}
function isPaintReference(
  value: string,
  definitionKinds: ReadonlyMap<string, string>,
  kinds: readonly string[],
): boolean {
  const match = /^url\(\s*#([^\s)]+)\s*\)$/u.exec(value);
  return match !== null && kinds.includes(definitionKinds.get(match[1]!) ?? "");
}
function parseInlineStyle(value: string): Readonly<Record<string, string>> {
  const styles: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim();
    if (property && styleValue) styles[property] = styleValue;
  }
  return styles;
}

function normalizeOptions(options: number | InventoryOptions): {
  detailLimit: number;
  kinds?: readonly string[];
  offset: number;
} {
  const detailLimit =
    typeof options === "number" ? options : options.detailLimit;
  const offset = typeof options === "number" ? 0 : (options.offset ?? 0);
  const kinds = typeof options === "number" ? undefined : options.kinds;
  if (
    !Number.isInteger(detailLimit) ||
    detailLimit < 1 ||
    detailLimit > MAX_DETAIL_LIMIT ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100_000 ||
    (kinds !== undefined &&
      (kinds.length > 100 ||
        kinds.some((kind) => !/^[A-Za-z][A-Za-z0-9-]{0,127}$/u.test(kind))))
  )
    throw new Error("Inventory detail options are out of range");
  return { detailLimit, ...(kinds === undefined ? {} : { kinds }), offset };
}

function collectFontFamilies(value: string, target: Set<string>): void {
  for (const match of value.matchAll(/font-family\s*:\s*([^;}]+)/giu))
    for (const family of (match[1] ?? "").split(",")) {
      const normalized = family.trim().replace(/^['"]|['"]$/gu, "");
      if (normalized) target.add(normalized);
    }
}

function collectDefinition(
  element: XmlElement,
  definitions: {
    filters: { id: string; primitiveCount: number }[];
    gradients: { id: string; kind: "linear" | "radial"; stopCount: number }[];
    patterns: { height?: string; id: string; width?: string }[];
  },
  limit: number,
  truncate: () => void,
): void {
  const id = element.getAttribute("id");
  if (!id) return;
  const name = element.localName;
  if (name === "linearGradient" || name === "radialGradient") {
    if (definitions.gradients.length >= limit) return truncate();
    definitions.gradients.push({
      id,
      kind: name === "linearGradient" ? "linear" : "radial",
      stopCount: Array.from(element.childNodes).filter(
        (child) => child.nodeType === 1 && child.localName === "stop",
      ).length,
    });
  } else if (name === "pattern") {
    if (definitions.patterns.length >= limit) return truncate();
    definitions.patterns.push({
      ...(element.getAttribute("height") === null
        ? {}
        : { height: element.getAttribute("height")! }),
      id,
      ...(element.getAttribute("width") === null
        ? {}
        : { width: element.getAttribute("width")! }),
    });
  } else if (name === "filter") {
    if (definitions.filters.length >= limit) return truncate();
    definitions.filters.push({
      id,
      primitiveCount: Array.from(element.childNodes).filter(
        (child) => child.nodeType === 1,
      ).length,
    });
  }
}

function imageSummary(
  element: XmlElement,
  href: string,
): DocumentInventory["images"][number] {
  const display = {
    ...(element.getAttribute("height") === null
      ? {}
      : { height: element.getAttribute("height")! }),
    ...(element.getAttribute("width") === null
      ? {}
      : { width: element.getAttribute("width")! }),
  };
  const intrinsic = embeddedPngSize(href);
  return {
    display,
    intrinsic:
      intrinsic === undefined
        ? { status: "unavailable" }
        : { ...intrinsic, status: "available" },
    kind: imageKind(href),
  };
}

function embeddedPngSize(
  href: string,
): { height: number; width: number } | undefined {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/iu.exec(href);
  if (!match) return undefined;
  const payload = match[1] ?? "";
  // PNG dimensions occur in the IHDR header.  Decode a bounded prefix only:
  // inventories must never turn a multi-megabyte embedded image into output or
  // allocate it merely to inspect its size.
  const bytes = Buffer.from(payload.slice(0, 128), "base64");
  if (
    bytes.length < 24 ||
    bytes
      .subarray(0, 8)
      .compare(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ) !== 0 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { height, width } : undefined;
}

function* walk(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) yield* walk(node as XmlElement);
  }
}
function imageKind(value: string): "embedded" | "external" | "linked" {
  if (/^data:/iu.test(value)) return "embedded";
  return isExternalReference(value) ? "external" : "linked";
}
function isExternalReference(value: string): boolean {
  return /^(?:https?:|file:|data:|javascript:|\/\/)/iu.test(value);
}
function isHidden(element: XmlElement): boolean {
  const style = element.getAttribute("style") ?? "";
  return (
    element.getAttribute("display") === "none" ||
    element.getAttribute("visibility") === "hidden" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/iu.test(
      style,
    )
  );
}
