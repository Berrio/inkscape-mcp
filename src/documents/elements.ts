import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const PUBLIC_ELEMENT_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const ALLOWED_ATTRIBUTES = new Set([
  "class",
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
const MAX_ELEMENT_DEPTH = 128;
const MAX_SELECTOR_CLASSES = 8;
const MAX_SELECTOR_MATCHES = 10_000;
const SAFE_SELECTOR_KINDS = new Set([
  "circle",
  "ellipse",
  "g",
  "image",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
  "use",
]);
const SAFE_SELECTOR_ID = "[A-Za-z_][A-Za-z0-9_.-]{0,127}";
const SAFE_SELECTOR_CLASS = "[A-Za-z_][A-Za-z0-9_-]{0,127}";
const SAFE_SELECTOR = new RegExp(
  `^(?<kind>[A-Za-z][A-Za-z0-9-]*)?(?:#(?<id>${SAFE_SELECTOR_ID}))?(?<classes>(?:\\.${SAFE_SELECTOR_CLASS})*)$`,
  "u",
);

type CompiledSelector = {
  classes: readonly string[];
  id?: string | undefined;
  kind?: string | undefined;
};

export type ElementQuery = {
  ids?: readonly string[] | undefined;
  kinds?: readonly string[] | undefined;
  layerId?: string | undefined;
  limit: number;
  offset: number;
  selector?: string | undefined;
};
export type ElementSummary = {
  attributes: Readonly<Record<string, string>>;
  bounds?: {
    fidelity: "partial";
    height: number;
    kind: "visual";
    limitations: readonly ["GEOMETRIC_ENGINE_UNAVAILABLE"];
    source: "inkscape-query-all";
    width: number;
    x: number;
    y: number;
  };
  id?: string;
  kind: string;
  layerId?: string;
  parentId?: string;
};

export type ElementQueryTarget = {
  nativeId?: string | undefined;
  summary: ElementSummary;
};

export function querySvgElements(
  source: string,
  query: ElementQuery,
): {
  elements: readonly ElementSummary[];
  missingIds: readonly string[];
  total: number;
} {
  const result = querySvgElementTargets(source, query);
  return {
    elements: result.elements.map((element) => element.summary),
    missingIds: result.missingIds,
    total: result.total,
  };
}

export function querySvgElementTargets(
  source: string,
  query: ElementQuery,
): {
  elements: readonly ElementQueryTarget[];
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
  const selector =
    query.selector === undefined
      ? undefined
      : compileSafeSelector(query.selector);
  const ids = new Set([
    ...(query.ids ?? []),
    ...(selector?.id === undefined ? [] : [selector.id]),
  ]);
  const kinds = new Set(query.kinds ?? []);
  const all = Array.from(document.getElementsByTagName("*"));
  assertMaximumDepth(all);
  const presentIds = new Set(
    all.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [id];
    }),
  );
  const matched: XmlElement[] = [];
  for (const element of all) {
    const id = element.getAttribute("id");
    const layerId = findLayerId(element);
    if (
      (ids.size === 0 || (id !== null && ids.has(id))) &&
      (kinds.size === 0 || kinds.has(element.localName ?? "")) &&
      (query.layerId === undefined || layerId === query.layerId) &&
      (selector === undefined || matchesSelector(element, selector))
    ) {
      matched.push(element);
      if (matched.length > MAX_SELECTOR_MATCHES)
        throw new Error("Element selector exceeds the match limit");
    }
  }
  return {
    elements: matched
      .slice(query.offset, query.offset + query.limit)
      .map((element) => ({
        ...(element.getAttribute("id") === null
          ? {}
          : { nativeId: element.getAttribute("id")! }),
        summary: summarize(element),
      })),
    missingIds: [...ids].filter((id) => !presentIds.has(id)).sort(),
    total: matched.length,
  };
}

function compileSafeSelector(value: string): CompiledSelector {
  if (value.length < 1 || value.length > 256)
    throw new Error("Element selector length is out of range");
  const match = SAFE_SELECTOR.exec(value);
  if (!match?.groups)
    throw new Error(
      "Element selector must be one safe compound selector without combinators",
    );
  const kind = match.groups.kind;
  if (kind !== undefined && !SAFE_SELECTOR_KINDS.has(kind))
    throw new Error("Element selector kind is not supported");
  const classes = (match.groups.classes ?? "")
    .split(".")
    .filter((item) => item.length > 0);
  if (classes.length > MAX_SELECTOR_CLASSES)
    throw new Error("Element selector exceeds the class limit");
  return {
    classes,
    ...(match.groups.id === undefined ? {} : { id: match.groups.id }),
    ...(kind === undefined ? {} : { kind }),
  };
}

function matchesSelector(
  element: XmlElement,
  selector: CompiledSelector,
): boolean {
  if (selector.kind !== undefined && element.localName !== selector.kind)
    return false;
  if (selector.id !== undefined && element.getAttribute("id") !== selector.id)
    return false;
  if (selector.classes.length === 0) return true;
  const classes = new Set(
    (element.getAttribute("class") ?? "")
      .trim()
      .split(/\s+/u)
      .filter((item) => item.length > 0),
  );
  return selector.classes.every((className) => classes.has(className));
}

function assertMaximumDepth(elements: readonly XmlElement[]): void {
  for (const element of elements) {
    let depth = 0;
    let current: XmlElement | undefined = element;
    while (current) {
      depth += 1;
      if (depth > MAX_ELEMENT_DEPTH)
        throw new Error("SVG element nesting exceeds the query depth limit");
      current = parentElement(current);
    }
  }
}

function summarize(element: XmlElement): ElementSummary {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute && ALLOWED_ATTRIBUTES.has(attribute.name))
      attributes[attribute.name] = attribute.value;
  }
  const id = publicId(element.getAttribute("id"));
  const parentId = publicId(parentElement(element)?.getAttribute("id") ?? null);
  const layerId = publicId(findLayerId(element) ?? null);
  return {
    attributes,
    ...(id === undefined ? {} : { id }),
    kind: element.localName ?? "unknown",
    ...(layerId === undefined ? {} : { layerId }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function publicId(value: string | null): string | undefined {
  return value !== null && PUBLIC_ELEMENT_ID.test(value) ? value : undefined;
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
