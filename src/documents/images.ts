import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const IMAGE_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export type EmbeddedRaster = { bytes: Buffer; mime: string };

export function setSvgImageHref(
  source: string,
  imageId: string,
  href: string,
): string {
  if (!SAFE_ID.test(imageId)) throw new Error("Image ID is invalid");
  if (!isSafeImageHref(href)) throw new Error("Image href is invalid");
  const document = parseDocument(source);
  const image = findById(document, imageId);
  if (!image || image.localName !== "image")
    throw new Error("Image ID does not name an SVG image");
  image.setAttribute("href", href);
  image.removeAttribute("xlink:href");
  return new XMLSerializer().serializeToString(document);
}

export function extractEmbeddedRaster(
  source: string,
  imageId: string,
  maxBytes: number,
): EmbeddedRaster {
  if (!SAFE_ID.test(imageId)) throw new Error("Image ID is invalid");
  if (!Number.isInteger(maxBytes) || maxBytes < 1)
    throw new Error("Image extraction limit is invalid");
  const document = parseDocument(source);
  const image = findById(document, imageId);
  if (!image || image.localName !== "image")
    throw new Error("Image ID does not name an SVG image");
  const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
  if (href === null) throw new Error("Image does not have an href");
  return parseEmbeddedRasterDataUri(href, maxBytes);
}

export function parseEmbeddedRasterDataUri(
  value: string,
  maxBytes: number,
): EmbeddedRaster {
  const match =
    /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(
      value,
    );
  if (!match || !IMAGE_MIME_TYPES.has(match[1]!.toLowerCase()))
    throw new Error("Image is not an embedded supported raster");
  const payload = match[2]!;
  if (payload.length > Math.ceil((maxBytes * 4) / 3) + 4)
    throw new Error("Embedded image exceeds the configured size limit");
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length < 1 || bytes.length > maxBytes)
    throw new Error("Embedded image exceeds the configured size limit");
  return { bytes, mime: match[1]!.toLowerCase() };
}

function isSafeImageHref(href: string): boolean {
  return (
    /^data:image\/(?:bmp|gif|jpeg|png|tiff|webp);base64,[A-Za-z0-9+/]+={0,2}$/iu.test(
      href,
    ) ||
    (/^(?!\/|\\|[A-Za-z]:|\/\/)[A-Za-z0-9._~!$&'()*+,;=@%/\\-]+$/u.test(href) &&
      !href.includes("\\"))
  );
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing images");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}
