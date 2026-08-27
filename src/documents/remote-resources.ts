import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type RemoteSvgResource = {
  attribute: string;
  element: string;
  id?: string;
  scheme: "file" | "http" | "https" | "protocol-relative";
};

export function inspectSvgRemoteResources(
  source: string,
): readonly RemoteSvgResource[] {
  sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  const resources: RemoteSvgResource[] = [];
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (
        attribute !== null &&
        (attribute.name === "xmlns" || attribute.prefix === "xmlns")
      )
        continue;
      const scheme =
        attribute === null ? undefined : remoteScheme(attribute.value);
      if (!attribute || scheme === undefined) continue;
      resources.push({
        attribute: attribute.name,
        element: element.localName ?? "unknown",
        ...(element.getAttribute("id") === null
          ? {}
          : { id: element.getAttribute("id")! }),
        scheme,
      });
    }
    if (element.localName !== "style") continue;
    for (const scheme of styleSchemes(element.textContent ?? ""))
      resources.push({ attribute: "style", element: "style", scheme });
  }
  return resources;
}

function remoteScheme(value: string): RemoteSvgResource["scheme"] | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("https:")) return "https";
  if (normalized.startsWith("http:")) return "http";
  if (normalized.startsWith("file:")) return "file";
  if (normalized.startsWith("//")) return "protocol-relative";
  return undefined;
}

function styleSchemes(value: string): RemoteSvgResource["scheme"][] {
  return [...value.matchAll(/url\(\s*['"]?([^'")\s]+)/giu)]
    .map((match) => remoteScheme(match[1] ?? ""))
    .filter(
      (scheme): scheme is RemoteSvgResource["scheme"] => scheme !== undefined,
    );
}
