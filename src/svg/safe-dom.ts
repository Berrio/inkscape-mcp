import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

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

export function sanitizeSvg(
  source: string,
  options: SafeSvgOptions,
): SafeSvgResult {
  if (!isAllowedMode(options.mode, options.maximumMode ?? options.mode)) {
    throw new SvgSecurityError(
      "Requested sanitize mode exceeds configured maximum",
    );
  }
  if (Buffer.byteLength(source, "utf8") > options.maxInputBytes)
    throw new SvgSecurityError("SVG exceeds input size limit");
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(source))
    throw new SvgSecurityError("DTD, entities and CDATA are not allowed");
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        throw new SvgSecurityError(`Malformed SVG: ${message}`);
      }
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg")
    throw new SvgSecurityError("Root element must be svg");
  const elements = [...walk(root as unknown as XmlElement)];
  if (elements.length > options.maxElements)
    throw new SvgSecurityError("SVG exceeds element limit");
  const removed: string[] = [];
  for (const element of elements) {
    const name = element.localName.toLowerCase();
    if (
      name === "script" ||
      (options.mode === "strict" && name === "foreignobject")
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
      if (
        (attributeName === "href" || attributeName === "xlink:href") &&
        isForbiddenReference(value, options.mode)
      ) {
        element.removeAttribute(attribute.name);
        removed.push(`reference:${attribute.name}`);
      }
    }
  }
  return { removed, svg: new XMLSerializer().serializeToString(document) };
}

type XmlElement = {
  attributes: {
    item(index: number): { name: string; value: string } | null | undefined;
    length: number;
  };
  firstChild: XmlNode | null;
  localName: string;
  nextSibling: XmlNode | null;
  nodeType: number;
  parentNode: { removeChild(node: XmlElement): void } | null;
  removeAttribute(name: string): void;
};
type XmlNode = XmlElement;

function* walk(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (let child = root.firstChild; child; child = child.nextSibling)
    if (child.nodeType === 1) yield* walk(child);
}
function remove(element: XmlElement, name: string, removed: string[]): void {
  element.parentNode?.removeChild(element);
  removed.push(`element:${name}`);
}
function isForbiddenReference(value: string, mode: SanitizeMode): boolean {
  if (mode === "trusted") return false;
  if (mode === "strict") return !value.startsWith("#");
  return /^(?:https?:|file:|data:|javascript:|\/\/)/iu.test(value);
}
function isAllowedMode(
  requested: SanitizeMode,
  maximum: SanitizeMode,
): boolean {
  return (
    ["strict", "preserve-local", "trusted"].indexOf(requested) <=
    ["strict", "preserve-local", "trusted"].indexOf(maximum)
  );
}
