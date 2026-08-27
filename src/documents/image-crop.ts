import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type SvgImageCrop = {
  clipId: string;
  height: number;
  imageId: string;
  width: number;
  x: number;
  y: number;
};

export function cropSvgImage(source: string, request: SvgImageCrop): string {
  if (!SAFE_ID.test(request.clipId) || !SAFE_ID.test(request.imageId))
    throw new Error("Image and clip IDs are invalid");
  for (const value of [request.x, request.y, request.width, request.height])
    if (!Number.isFinite(value))
      throw new Error("Crop coordinates must be finite");
  if (request.width <= 0 || request.height <= 0)
    throw new Error("Crop width and height must be positive");
  const document = parseDocument(source);
  const image = findById(document, request.imageId);
  if (!image || image.localName !== "image")
    throw new Error("Image ID does not name an SVG image");
  if (image.hasAttribute("clip-path"))
    throw new Error(
      "Image already has a clip path; replace it explicitly first",
    );
  if (findById(document, request.clipId))
    throw new Error("Clip ID already exists");
  const defs = ensureDefs(document);
  const clip = document.createElementNS(SVG_NAMESPACE, "clipPath");
  clip.setAttribute("id", request.clipId);
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("x", String(request.x));
  rect.setAttribute("y", String(request.y));
  rect.setAttribute("width", String(request.width));
  rect.setAttribute("height", String(request.height));
  clip.appendChild(rect);
  defs.appendChild(clip);
  image.setAttribute("clip-path", `url(#${request.clipId})`);
  return new XMLSerializer().serializeToString(document);
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before cropping images");
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
function ensureDefs(document: XmlDocument): XmlElement {
  const existing = Array.from(document.getElementsByTagName("defs"))[0];
  if (existing) return existing;
  const defs = document.createElementNS(SVG_NAMESPACE, "defs");
  document.documentElement!.insertBefore(
    defs,
    document.documentElement!.firstChild,
  );
  return defs;
}
