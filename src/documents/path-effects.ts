import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";

export function inspectSvgPathEffects(source: string): {
  effects: readonly { id: string; type: string; usedBy: readonly string[] }[];
} {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before inspecting path effects");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const all = Array.from(document.getElementsByTagName("*"));
  return {
    effects: all
      .filter((element) => element.localName === "path-effect")
      .flatMap((effect) => {
        const id = effect.getAttribute("id");
        if (!id) return [];
        const usedBy = all
          .filter((element) =>
            (
              element.getAttributeNS(INKSCAPE_NAMESPACE, "path-effect") ??
              element.getAttribute("inkscape:path-effect") ??
              ""
            )
              .split(/[;,\s]+/u)
              .includes(`#${id}`),
          )
          .map((element) => element.getAttribute("id"))
          .filter((candidate): candidate is string => candidate !== null);
        return [
          { id, type: effect.getAttribute("effect") ?? "unknown", usedBy },
        ];
      }),
  };
}
