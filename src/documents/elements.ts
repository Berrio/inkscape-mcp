import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

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
const COMPUTED_STYLE_PROPERTIES = new Set([
  "color",
  "display",
  "fill",
  "fill-opacity",
  "filter",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "visibility",
]);
const INHERITED_STYLE_PROPERTIES = new Set([
  "color",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "visibility",
]);

type CompiledSelector = {
  classes: readonly string[];
  id?: string | undefined;
  kind?: string | undefined;
};

export type ElementQuery = {
  includeComputedStyle?: boolean | undefined;
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
  computedStyle?: {
    fidelity: "exact-supported" | "partial";
    limitations: readonly string[];
    properties: Readonly<Record<string, string>>;
  };
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
  const computedStyles = query.includeComputedStyle
    ? createComputedStyleResolver(document)
    : undefined;
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
        summary: summarize(
          element,
          computedStyles === undefined ? undefined : computedStyles(element),
        ),
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

function summarize(
  element: XmlElement,
  computedStyle?: ElementSummary["computedStyle"],
): ElementSummary {
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
    ...(computedStyle === undefined ? {} : { computedStyle }),
    ...(id === undefined ? {} : { id }),
    kind: element.localName ?? "unknown",
    ...(layerId === undefined ? {} : { layerId }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

type StyleDeclaration = {
  important: boolean;
  property: string;
  value: string;
};
type StyleRule = {
  declarations: readonly StyleDeclaration[];
  order: number;
  selector: CompiledSelector;
  specificity: number;
};
type ComputedStyleResolver = (
  element: XmlElement,
) => NonNullable<ElementSummary["computedStyle"]>;

/** Resolves the intentionally small, auditable CSS subset exposed by the API.
 * Unsupported selector programs and custom-property expressions are retained in
 * the source SVG but flagged instead of being represented as computed truth. */
function createComputedStyleResolver(
  document: XmlDocument,
): ComputedStyleResolver {
  const parsed = parseSupportedStyles(document);
  const cache = new Map<XmlElement, Readonly<Record<string, string>>>();
  const resolve = (element: XmlElement): Readonly<Record<string, string>> => {
    const existing = cache.get(element);
    if (existing) return existing;
    const properties: Record<string, string> = {};
    const parent = parentElement(element);
    if (parent) {
      const inherited = resolve(parent);
      for (const property of INHERITED_STYLE_PROPERTIES) {
        const value = inherited[property];
        if (value !== undefined) properties[property] = value;
      }
    }
    const candidates = new Map<
      string,
      {
        important: number;
        order: number;
        origin: number;
        specificity: number;
        value: string;
      }
    >();
    const set = (
      declaration: StyleDeclaration,
      origin: number,
      specificity: number,
      order: number,
    ): void => {
      if (!COMPUTED_STYLE_PROPERTIES.has(declaration.property)) return;
      const next = {
        important: declaration.important ? 1 : 0,
        order,
        origin,
        specificity,
        value: declaration.value,
      };
      const previous = candidates.get(declaration.property);
      if (
        previous === undefined ||
        next.important > previous.important ||
        (next.important === previous.important &&
          next.origin > previous.origin) ||
        (next.important === previous.important &&
          next.origin === previous.origin &&
          next.specificity > previous.specificity) ||
        (next.important === previous.important &&
          next.origin === previous.origin &&
          next.specificity === previous.specificity &&
          next.order >= previous.order)
      )
        candidates.set(declaration.property, next);
    };
    for (const property of COMPUTED_STYLE_PROPERTIES) {
      const value = element.getAttribute(property);
      if (value !== null) set({ important: false, property, value }, 0, 0, 0);
    }
    for (const rule of parsed.rules)
      if (matchesSelector(element, rule.selector))
        for (const declaration of rule.declarations)
          set(declaration, 1, rule.specificity, rule.order);
    for (const declaration of parseStyleDeclarations(
      element.getAttribute("style") ?? "",
    ))
      set(declaration, 2, 1_000, Number.MAX_SAFE_INTEGER);
    for (const [property, candidate] of candidates)
      properties[property] = candidate.value;
    cache.set(element, properties);
    return properties;
  };
  return (element) => ({
    fidelity: parsed.limitations.length === 0 ? "exact-supported" : "partial",
    limitations: parsed.limitations,
    properties: resolve(element),
  });
}

function parseSupportedStyles(document: XmlDocument): {
  limitations: readonly string[];
  rules: readonly StyleRule[];
} {
  const limitations = new Set<string>();
  const rules: StyleRule[] = [];
  let order = 0;
  for (const style of Array.from(document.getElementsByTagName("style"))) {
    const source = style.textContent ?? "";
    if (/@(?:import|media|supports|keyframes|font-face)\b/iu.test(source))
      limitations.add("CSS_AT_RULE");
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const declarations = parseStyleDeclarations(match[2]!);
      if (
        declarations.some((declaration) => /\bvar\(/iu.test(declaration.value))
      )
        limitations.add("CSS_CUSTOM_PROPERTY");
      for (const rawSelector of match[1]!.split(",")) {
        const selectorText = rawSelector.trim();
        try {
          const selector = compileSafeSelector(selectorText);
          rules.push({
            declarations,
            order: order++,
            selector,
            specificity:
              (selector.id === undefined ? 0 : 100) +
              selector.classes.length * 10 +
              (selector.kind === undefined ? 0 : 1),
          });
        } catch {
          limitations.add("CSS_SELECTOR_UNSUPPORTED");
        }
      }
    }
  }
  return { limitations: [...limitations].sort(), rules };
}

function parseStyleDeclarations(value: string): readonly StyleDeclaration[] {
  const declarations: StyleDeclaration[] = [];
  for (const source of value.split(";")) {
    const separator = source.indexOf(":");
    if (separator < 1) continue;
    const property = source.slice(0, separator).trim().toLowerCase();
    const rawValue = source.slice(separator + 1).trim();
    if (!property || !rawValue) continue;
    const important = /\s*!important\s*$/iu.test(rawValue);
    declarations.push({
      important,
      property,
      value: rawValue.replace(/\s*!important\s*$/iu, "").trim(),
    });
  }
  return declarations;
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
