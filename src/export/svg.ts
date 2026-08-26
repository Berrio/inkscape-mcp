import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const URL_FRAGMENT = /url\(\s*(['"]?)#([^'"\s)]+)\1\s*\)/giu;
const DIRECT_REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href"]);
const ID_LIST_ATTRIBUTES = new Set(["aria-describedby", "aria-labelledby"]);

export type SvgMetadata = {
  byteLength: number;
  hash: string;
  idCount: number;
  referenceCount: number;
  viewBox: string;
};

export async function verifySvg(path: string): Promise<SvgMetadata> {
  const bytes = await readFile(path);
  const source = bytes.toString("utf8");
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("Exported SVG violates the SVG safety policy");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (
    !root ||
    root.localName !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE ||
    root.getAttribute("xmlns") !== SVG_NAMESPACE
  )
    throw new Error("Exported SVG has an invalid namespace");
  const viewBox = root.getAttribute("viewBox") ?? undefined;
  const values = viewBox?.trim().split(/[ ,]+/u).map(Number);
  if (
    viewBox === undefined ||
    values === undefined ||
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[2]! <= 0 ||
    values[3]! <= 0
  )
    throw new Error("Exported SVG has an invalid viewBox");
  const elements = [
    root,
    ...Array.from(document.getElementsByTagName("*")).filter(
      (element) => element !== root,
    ),
  ];
  const ids = new Set<string>();
  const references: string[] = [];
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id !== null) {
      if (!SAFE_ID.test(id)) throw new Error("Exported SVG has an invalid ID");
      if (ids.has(id)) throw new Error("Exported SVG has a duplicate ID");
      ids.add(id);
    }
    collectReferences(element, references);
  }
  for (const reference of references)
    if (!ids.has(reference))
      throw new Error("Exported SVG has an unresolved internal reference");
  return {
    byteLength: bytes.byteLength,
    hash: createHash("sha256").update(bytes).digest("hex"),
    idCount: ids.size,
    referenceCount: references.length,
    viewBox,
  };
}

function collectReferences(element: XmlElement, references: string[]): void {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    if (DIRECT_REFERENCE_ATTRIBUTES.has(name)) {
      collectDirectReference(attribute.value, references);
      continue;
    }
    if (ID_LIST_ATTRIBUTES.has(name)) {
      for (const id of attribute.value.trim().split(/\s+/u))
        if (id) collectId(id, references);
    }
    collectUrlReferences(attribute.value, references);
  }
  if (element.localName === "style")
    collectUrlReferences(element.textContent ?? "", references);
}

function collectDirectReference(value: string, references: string[]): void {
  if (!value.startsWith("#")) return;
  collectId(value.slice(1), references);
}

function collectUrlReferences(value: string, references: string[]): void {
  for (const match of value.matchAll(URL_FRAGMENT))
    collectId(match[2]!, references);
}

function collectId(id: string, references: string[]): void {
  if (!SAFE_ID.test(id))
    throw new Error("Exported SVG has an invalid internal reference");
  references.push(id);
}
