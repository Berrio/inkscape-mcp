import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const MAX_SVG_DEPTH = 256;

export type SanitizeMode = "preserve-local" | "strict" | "trusted";
export type SafeSvgOptions = {
  maxElements: number;
  maxInputBytes: number;
  maximumMode?: SanitizeMode;
  mode: SanitizeMode;
};
export type SafeSvgResult = { removed: readonly string[]; svg: string };

export class SvgSecurityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SvgSecurityError";
  }
}

/** Startup-configured ceiling applied to every sanitizer call in the process. */
export type SvgSecurityPolicy = {
  maxInputBytes?: number | undefined;
  maximumMode?: SanitizeMode | undefined;
};
const SANITIZE_MODE_ORDER: readonly SanitizeMode[] = [
  "strict",
  "preserve-local",
  "trusted",
];
let processPolicy: SvgSecurityPolicy = {};

/**
 * Applies the operator's startup limits (`maxInputBytes`,
 * `maximumSanitizeMode`) to every internal caller, including document tools
 * that request a fixed mode. A configured maximum only ever makes a request
 * more restrictive; it never elevates one.
 */
export function configureSvgSecurityPolicy(policy: SvgSecurityPolicy): void {
  if (
    policy.maxInputBytes !== undefined &&
    (!Number.isSafeInteger(policy.maxInputBytes) || policy.maxInputBytes < 1)
  )
    throw new Error("SVG policy maxInputBytes must be a positive integer");
  processPolicy = { ...policy };
}

export function sanitizeSvg(
  source: string,
  options: SafeSvgOptions,
): SafeSvgResult {
  if (!isAllowedMode(options.mode, options.maximumMode ?? options.mode)) {
    throw new SvgSecurityError(
      "Requested sanitize mode exceeds configured maximum",
    );
  }
  const mode =
    processPolicy.maximumMode !== undefined &&
    !isAllowedMode(options.mode, processPolicy.maximumMode)
      ? processPolicy.maximumMode
      : options.mode;
  const maxInputBytes = processPolicy.maxInputBytes ?? options.maxInputBytes;
  if (Buffer.byteLength(source, "utf8") > maxInputBytes)
    throw new SvgSecurityError("SVG exceeds input size limit");
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(source))
    throw new SvgSecurityError("DTD, entities and CDATA are not allowed");
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        throw new SvgSecurityError(`Malformed SVG: ${message}`);
      }
    },
  });
  let document: ReturnType<typeof parser.parseFromString>;
  try {
    document = parser.parseFromString(source, "image/svg+xml");
  } catch {
    // xmldom may wrap onError exceptions in ParseError. Keep the public error
    // stable and avoid exposing parser internals or document fragments.
    throw new SvgSecurityError("Malformed SVG");
  }
  const root = document.documentElement;
  if (!root || root.localName !== "svg")
    throw new SvgSecurityError("Root element must be svg");
  const elements: XmlElement[] = [];
  for (const element of walk(root as unknown as XmlElement)) {
    elements.push(element);
    if (elements.length > options.maxElements)
      throw new SvgSecurityError("SVG exceeds element limit");
  }
  const removed: string[] = [];
  if (mode !== "trusted")
    removeProcessingInstructions(
      document as unknown as XmlNode,
      elements,
      removed,
    );
  for (const element of elements) {
    const name = element.localName.toLowerCase();
    if (
      name === "script" ||
      (mode === "strict" && name === "foreignobject") ||
      (name === "style" &&
        hasForbiddenCssReference(element.textContent, mode)) ||
      (ANIMATION_ELEMENTS.has(name) &&
        hasForbiddenAnimatedReference(element, mode))
    ) {
      remove(element, name, removed);
      continue;
    }
    for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (attributeName.startsWith("on")) {
        element.removeAttribute(attribute.name);
        removed.push(`attribute:${attribute.name}`);
        continue;
      }
      const reference = svgReferenceAttributeKind(attribute);
      if (
        (reference === "base" && mode !== "trusted") ||
        (reference !== undefined &&
          reference !== "base" &&
          isForbiddenReference(value, mode)) ||
        (mayContainCssReference(value) && hasForbiddenCssReference(value, mode))
      ) {
        element.removeAttribute(attribute.name);
        removed.push(`reference:${attribute.name}`);
      }
    }
  }
  return { removed, svg: new XMLSerializer().serializeToString(document) };
}

export type SvgReferenceAttributeKind = "absref" | "base" | "href" | "src";

/**
 * Classifies URI-bearing attributes by local name and namespace, never by the
 * literal qualified name: `xl:href` bound to XLink is the same attribute as
 * `xlink:href`, and Inkscape falls back to `sodipodi:absref` for images.
 */
export function svgReferenceAttributeKind(attribute: {
  localName?: string | null;
  name: string;
  namespaceURI?: string | null;
}): SvgReferenceAttributeKind | undefined {
  const localName = (
    attribute.localName ??
    attribute.name.split(":").at(-1) ??
    ""
  ).toLowerCase();
  if (localName === "href") return "href";
  if (localName === "absref") return "absref";
  if (localName === "src" && !attribute.name.includes(":")) return "src";
  if (
    localName === "base" &&
    (attribute.namespaceURI === XML_NAMESPACE ||
      attribute.name.toLowerCase() === "xml:base")
  )
    return "base";
  return undefined;
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const ANIMATION_ELEMENTS = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "set",
]);

type XmlAttribute = {
  localName?: string | null;
  name: string;
  namespaceURI?: string | null;
  value: string;
};
type XmlElement = {
  attributes: {
    item(index: number): XmlAttribute | null | undefined;
    length: number;
  };
  childNodes?: { item(index: number): XmlNode | null; length: number };
  firstChild: XmlNode | null;
  getAttribute?(name: string): string | null;
  localName: string;
  nextSibling: XmlNode | null;
  nodeName?: string;
  nodeType: number;
  parentNode: { removeChild(node: XmlElement): void } | null;
  removeAttribute(name: string): void;
  textContent: string;
};
type XmlNode = XmlElement;

function* walk(root: XmlElement): Generator<XmlElement> {
  const pending: Array<{ depth: number; element: XmlElement }> = [
    { depth: 1, element: root },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_SVG_DEPTH)
      throw new SvgSecurityError("SVG exceeds element nesting limit");
    yield current.element;
    const children: XmlElement[] = [];
    for (
      let child = current.element.firstChild;
      child;
      child = child.nextSibling
    )
      if (child.nodeType === 1) children.push(child);
    for (let index = children.length - 1; index >= 0; index -= 1)
      pending.push({ depth: current.depth + 1, element: children[index]! });
  }
}
function remove(element: XmlElement, name: string, removed: string[]): void {
  element.parentNode?.removeChild(element);
  removed.push(`element:${name}`);
}
/** Removes every processing instruction except the XML declaration; a PI
 * such as `xml-stylesheet` can make a renderer fetch an external resource. */
function removeProcessingInstructions(
  document: XmlNode,
  elements: readonly XmlElement[],
  removed: string[],
): void {
  for (const parent of [document, ...elements]) {
    const instructions: XmlNode[] = [];
    for (let child = parent.firstChild; child; child = child.nextSibling)
      if (child.nodeType === 7 && child.nodeName?.toLowerCase() !== "xml")
        instructions.push(child);
    for (const instruction of instructions) {
      (parent as unknown as { removeChild(node: XmlNode): void }).removeChild(
        instruction,
      );
      removed.push(`instruction:${instruction.nodeName ?? "unknown"}`);
    }
  }
}
/** SMIL can assign a reference that never appears as a static attribute. */
function hasForbiddenAnimatedReference(
  element: XmlElement,
  mode: SanitizeMode,
): boolean {
  if (mode === "trusted") return false;
  const target = (element.getAttribute?.("attributeName") ?? "").trim();
  const values = ["by", "from", "to", "values"].flatMap((name) =>
    (element.getAttribute?.(name) ?? "").split(";").map((item) => item.trim()),
  );
  if (
    svgReferenceAttributeKind({ name: target }) !== undefined &&
    values.some((value) => value !== "" && isForbiddenReference(value, mode))
  )
    return true;
  return values.some(
    (value) =>
      mayContainCssReference(value) && hasForbiddenCssReference(value, mode),
  );
}
function isForbiddenReference(value: string, mode: SanitizeMode): boolean {
  if (mode === "trusted") return false;
  if (mode === "strict") return !value.startsWith("#");
  if (isSafeEmbeddedRasterDataUri(value)) return false;
  // UNC and protocol-relative references leave the machine or workspace.
  if (/^[\\/]{2}/u.test(value)) return true;
  // A drive path is local; the native input bundle still rejects it.
  if (/^[a-z]:[\\/]/iu.test(value)) return false;
  return /^[a-z][a-z0-9+.-]*:/iu.test(value);
}
function isSafeEmbeddedRasterDataUri(value: string): boolean {
  return /^data:image\/(?:bmp|gif|jpeg|png|tiff|webp|x-tga);base64,[A-Za-z0-9+/]+={0,2}$/iu.test(
    value,
  );
}
function mayContainCssReference(value: string): boolean {
  return /url\(|@import|\\|javascript/iu.test(value);
}
/** Decodes CSS escapes so `u\72l(` cannot hide a reference from the scanner. */
export function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/giu, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    })
    .replace(/\\([^\r\n\f0-9a-f])/giu, "$1");
}
function countCssReferenceKeywords(value: string): number {
  return [...value.matchAll(/url\(|@import/giu)].length;
}
function hasForbiddenCssReference(value: string, mode: SanitizeMode): boolean {
  if (mode === "trusted") return false;
  const decoded = decodeCssEscapes(value);
  if (/javascript\s*:/iu.test(decoded)) return true;
  // A keyword assembled from escapes (`u\72l(`) is invisible to the staging
  // bundle, which rewrites literal `url(`/`@import` tokens only. Escaped
  // selectors such as `#legacy\:id` next to a literal `url(#id)` are fine.
  if (countCssReferenceKeywords(decoded) > countCssReferenceKeywords(value))
    return true;
  const references = [
    ...decoded.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/giu),
    ...decoded.matchAll(
      /@import\s+(?:url\(\s*)?(['"]?)([^'"\s);]+)\1\s*\)?/giu,
    ),
  ];
  return references.some((match) => isForbiddenReference(match[2] ?? "", mode));
}
function isAllowedMode(
  requested: SanitizeMode,
  maximum: SanitizeMode,
): boolean {
  return (
    SANITIZE_MODE_ORDER.indexOf(requested) <=
    SANITIZE_MODE_ORDER.indexOf(maximum)
  );
}
