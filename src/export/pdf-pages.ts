import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const SAFE_PAGE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

/**
 * Produces a derived, single-purpose SVG for a PDF subset. Inkscape 1.4.4
 * writes separate files for --export-page, so pages are pruned instead and
 * the derived SVG is exported without that flag.
 */
export function pruneSvgPagesForPdf(
  source: string,
  pageIds: readonly string[],
): { pageIds: readonly string[]; svg: string } {
  if (pageIds.length < 1 || pageIds.length > 100)
    throw new Error("PDF subset page count is out of range");
  if (
    new Set(pageIds).size !== pageIds.length ||
    pageIds.some((id) => !SAFE_PAGE_ID.test(id))
  )
    throw new Error("PDF subset page IDs are invalid");
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before creating a PDF subset");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const pages = Array.from(
    document.getElementsByTagNameNS(INKSCAPE_NAMESPACE, "page"),
  );
  const byId = new Map(pages.map((page) => [page.getAttribute("id"), page]));
  const missing = pageIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error("PDF subset page does not exist");

  const selected = pageIds.map((id) => byId.get(id)!);
  const namedView = selected[0]!.parentNode;
  if (!namedView) throw new Error("PDF subset pages have no parent");
  for (const page of pages) page.parentNode?.removeChild(page);
  for (const page of selected) namedView.appendChild(page);
  return { pageIds: [...pageIds], svg: serialize(document) };
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
