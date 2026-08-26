import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const DIRECT_REFERENCE_ATTRIBUTES = new Set(["href", "src", "xlink:href"]);
const CSS_URL = /url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/giu;
const CSS_IMPORT = /@import\s+(['"])([^'"]+)\1/giu;

/** Rewrites only staged local asset URIs in SVG attributes and CSS. */
export function rewriteStagedAssetReferences(
  source: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) return source;
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      const rewritten = DIRECT_REFERENCE_ATTRIBUTES.has(
        attribute.name.toLowerCase(),
      )
        ? rewriteReference(attribute.value, replacements)
        : rewriteCssReferences(attribute.value, replacements);
      if (rewritten !== attribute.value)
        element.setAttribute(attribute.name, rewritten);
    }
    if (element.localName === "style" && element.textContent) {
      const rewritten = rewriteCssReferences(element.textContent, replacements);
      if (rewritten !== element.textContent) element.textContent = rewritten;
    }
  }
  return new XMLSerializer().serializeToString(document);
}

function rewriteReference(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  for (const [staged, published] of replacements) {
    if (value === staged) return published;
    if (
      value.startsWith(staged) &&
      (value[staged.length] === "#" || value[staged.length] === "?")
    )
      return `${published}${value.slice(staged.length)}`;
  }
  return value;
}

function rewriteCssReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return value
    .replace(CSS_URL, (whole, quote: string, reference: string) => {
      const rewritten = rewriteReference(reference, replacements);
      return rewritten === reference
        ? whole
        : `url(${quote}${rewritten}${quote})`;
    })
    .replace(CSS_IMPORT, (whole, quote: string, reference: string) => {
      const rewritten = rewriteReference(reference, replacements);
      return rewritten === reference
        ? whole
        : `@import ${quote}${rewritten}${quote}`;
    });
}
