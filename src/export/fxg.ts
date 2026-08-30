import { DOMParser, type Element } from "@xmldom/xmldom";

export const FXG_EXPORT_ADAPTER = "inkscape-fxg/v1" as const;

export type FxgMetadata = {
  byteLength: number;
  version: "1.0" | "2.0";
};

/** Validates a bounded, non-active FXG XML document before it is considered usable. */
export function inspectFxg(bytes: Uint8Array): FxgMetadata {
  if (bytes.length === 0 || [...bytes].some((byte) => byte === 0))
    throw new Error("FXG output is empty or contains NUL bytes");
  const source = Buffer.from(bytes).toString("utf8");
  if (
    source.includes("\uFFFD") ||
    /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(source)
  ) {
    throw new Error("FXG output contains invalid or active XML declarations");
  }
  let malformed = false;
  const document = new DOMParser({
    onError: (level) => {
      if (level !== "warning") malformed = true;
    },
  }).parseFromString(source, "application/xml");
  const root = document.documentElement;
  const version = root?.getAttribute("version");
  if (malformed || !root || root.localName !== "Graphic")
    throw new Error("FXG output is missing its Graphic root");
  if (version !== "1.0" && version !== "2.0")
    throw new Error("FXG output has an unsupported version");
  if (!hasDrawableDescendant(root))
    throw new Error("FXG output has no drawable content");
  return { byteLength: bytes.length, version };
}

function hasDrawableDescendant(root: Element): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (
      current !== root &&
      ["BitmapGraphic", "Ellipse", "Line", "Path", "Rect"].includes(
        current.localName ?? "",
      )
    ) {
      return true;
    }
    for (const child of Array.from(current.childNodes))
      if (child.nodeType === 1) pending.push(child as Element);
  }
  return false;
}
