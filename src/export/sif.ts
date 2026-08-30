import { DOMParser, type Element } from "@xmldom/xmldom";

export const SIF_EXPORT_ADAPTER = "inkscape-sif/v1" as const;

export type SifMetadata = {
  byteLength: number;
  layerCount: number;
  version: string;
};

/** Performs a structural check for a non-active Synfig SIF canvas. */
export function inspectSif(bytes: Uint8Array): SifMetadata {
  if (bytes.length === 0 || [...bytes].some((byte) => byte === 0))
    throw new Error("SIF output is empty or contains NUL bytes");
  const source = Buffer.from(bytes).toString("utf8");
  if (
    source.includes("\uFFFD") ||
    /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(source)
  ) {
    throw new Error("SIF output contains invalid or active XML declarations");
  }
  let malformed = false;
  const document = new DOMParser({
    onError: (level) => {
      if (level !== "warning") malformed = true;
    },
  }).parseFromString(source, "application/xml");
  const root = document.documentElement;
  const version = root?.getAttribute("version")?.trim();
  if (malformed || !root || root.localName !== "canvas")
    throw new Error("SIF output is missing its canvas root");
  if (!version || !/^\d+\.\d+(?:\.\d+)?$/u.test(version))
    throw new Error("SIF output has an invalid canvas version");
  const layerCount = countLayers(root);
  if (layerCount === 0) throw new Error("SIF output has no canvas layers");
  return { byteLength: bytes.length, layerCount, version };
}

function countLayers(root: Element): number {
  const pending = [root];
  let layerCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current !== root && current.localName === "layer") layerCount += 1;
    for (const child of Array.from(current.childNodes))
      if (child.nodeType === 1) pending.push(child as Element);
  }
  return layerCount;
}
