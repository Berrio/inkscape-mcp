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
  duplicateIds: readonly string[];
  elementCount: number;
  externalResourceCount: number;
  fontFamilies: readonly string[];
  fontResolution: "unavailable";
  images: readonly { kind: "embedded" | "external" | "linked" }[];
  ids: readonly string[];
  layers: readonly {
    id: string;
    label: string;
    locked: boolean;
    visibility: "hidden" | "visible";
  }[];
  namespaces: readonly string[];
  paintUsage: {
    fills: number;
    filters: number;
    gradients: number;
    opacities: number;
    patterns: number;
    strokes: number;
  };
  typeCounts: Readonly<Record<string, number>>;
  truncated: boolean;
  unknownNamespaces: readonly string[];
  unresolvedReferences: readonly string[];
};

export function inspectSvgInventory(
  source: string,
  detailLimit: number = 100,
): DocumentInventory {
  if (
    !Number.isInteger(detailLimit) ||
    detailLimit < 1 ||
    detailLimit > MAX_DETAIL_LIMIT
  )
    throw new Error("Inventory detail limit is out of range");
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
  const elements = [...walk(root)];
  const definitionKinds = new Map(
    elements.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : ([[id, element.localName ?? ""]] as const);
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
  const fontFamilies = new Set<string>();
  const paintUsage: DocumentInventory["paintUsage"] = {
    fills: 0,
    filters: 0,
    gradients: 0,
    opacities: 0,
    patterns: 0,
    strokes: 0,
  };
  let elementCount = 0;
  let externalResourceCount = 0;
  let truncated = false;
  for (const element of elements) {
    elementCount += 1;
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
      if (inspectedIds.length < detailLimit) inspectedIds.push(id);
      else truncated = true;
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
      else images.push({ kind: imageKind(href) });
    }
  }
  return {
    duplicateIds: [...duplicateIds].sort(),
    elementCount,
    externalResourceCount,
    fontFamilies: [...fontFamilies].sort(),
    fontResolution: "unavailable",
    images,
    ids: inspectedIds,
    layers,
    namespaces: [...namespaces].sort(),
    paintUsage,
    typeCounts,
    truncated,
    unknownNamespaces: [...namespaces]
      .filter((namespace) => !KNOWN_NAMESPACES.has(namespace))
      .sort(),
    unresolvedReferences: [...references].filter((id) => !ids.has(id)).sort(),
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
