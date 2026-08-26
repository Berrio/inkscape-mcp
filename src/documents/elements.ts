import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const ALLOWED_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "fill",
  "font-family",
  "font-size",
  "font-weight",
  "height",
  "opacity",
  "points",
  "r",
  "rx",
  "ry",
  "stroke",
  "stroke-width",
  "text-anchor",
  "transform",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

export type ElementQuery = {
  ids?: readonly string[] | undefined;
  kinds?: readonly string[] | undefined;
  layerId?: string | undefined;
  limit: number;
  offset: number;
};
export type ElementSummary = {
  attributes: Readonly<Record<string, string>>;
  id?: string;
  kind: string;
  layerId?: string;
  parentId?: string;
};

export function querySvgElements(
  source: string,
  query: ElementQuery,
): {
  elements: readonly ElementSummary[];
  missingIds: readonly string[];
  total: number;
} {
  if (!Number.isInteger(query.offset) || query.offset < 0)
    throw new Error("Element query offset must be a non-negative integer");
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1_000)
    throw new Error("Element query limit is out of range");
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(safe.svg, "image/svg+xml");
  const ids = new Set(query.ids ?? []);
  const kinds = new Set(query.kinds ?? []);
  const all = Array.from(document.getElementsByTagName("*"));
  const presentIds = new Set(
    all.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [id];
    }),
  );
  const matched = all
    .filter((element) => {
      const id = element.getAttribute("id");
      const layerId = findLayerId(element);
      return (
        (ids.size === 0 || (id !== null && ids.has(id))) &&
        (kinds.size === 0 || kinds.has(element.localName ?? "")) &&
        (query.layerId === undefined || layerId === query.layerId)
      );
    })
    .map(summarize);
  return {
    elements: matched.slice(query.offset, query.offset + query.limit),
    missingIds: [...ids].filter((id) => !presentIds.has(id)).sort(),
    total: matched.length,
  };
}

function summarize(element: XmlElement): ElementSummary {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute && ALLOWED_ATTRIBUTES.has(attribute.name))
      attributes[attribute.name] = attribute.value;
  }
  const id = element.getAttribute("id") ?? undefined;
  const parentId = parentElement(element)?.getAttribute("id") ?? undefined;
  const layerId = findLayerId(element);
  return {
    attributes,
    ...(id === undefined ? {} : { id }),
    kind: element.localName ?? "unknown",
    ...(layerId === undefined ? {} : { layerId }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}
function findLayerId(element: XmlElement): string | undefined {
  let current: XmlElement | undefined = element;
  while (current) {
    if (
      current.localName === "g" &&
      current.getAttributeNS(INKSCAPE_NAMESPACE, "groupmode") === "layer"
    )
      return current.getAttribute("id") ?? undefined;
    current = parentElement(current);
  }
  return undefined;
}
function parentElement(element: XmlElement): XmlElement | undefined {
  return element.parentNode?.nodeType === 1
    ? (element.parentNode as XmlElement)
    : undefined;
}
