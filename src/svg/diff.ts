import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import { sanitizeSvg } from "./safe-dom.js";

const PUBLIC_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type SvgSemanticDiff = {
  addedIds: readonly string[];
  afterElementCount: number;
  ambiguousIds: readonly string[];
  beforeElementCount: number;
  changedIds: readonly string[];
  removedIds: readonly string[];
};

/** Produces a bounded, content-free summary for a safe SVG mutation. */
export function summarizeSvgDiff(
  before: string,
  after: string,
): SvgSemanticDiff {
  const beforeElements = indexedElements(before);
  const afterElements = indexedElements(after);
  const addedIds = [...afterElements.byId.keys()]
    .filter((id) => !beforeElements.byId.has(id))
    .sort();
  const removedIds = [...beforeElements.byId.keys()]
    .filter((id) => !afterElements.byId.has(id))
    .sort();
  const changedIds = [...beforeElements.byId.keys()]
    .filter(
      (id) =>
        afterElements.byId.has(id) &&
        beforeElements.byId.get(id) !== afterElements.byId.get(id),
    )
    .sort();
  return {
    addedIds,
    afterElementCount: afterElements.count,
    ambiguousIds: [
      ...new Set([...beforeElements.ambiguous, ...afterElements.ambiguous]),
    ].sort(),
    beforeElementCount: beforeElements.count,
    changedIds,
    removedIds,
  };
}

function indexedElements(source: string): {
  ambiguous: readonly string[];
  byId: ReadonlyMap<string, string>;
  count: number;
} {
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(safe.svg, "image/svg+xml");
  const elements = Array.from(document.getElementsByTagName("*"));
  const byId = new Map<string, string>();
  const ambiguous = new Set<string>();
  const serializer = new XMLSerializer();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id === null || !PUBLIC_ID.test(id)) continue;
    if (byId.has(id)) {
      byId.delete(id);
      ambiguous.add(id);
      continue;
    }
    if (!ambiguous.has(id)) byId.set(id, serializer.serializeToString(element));
  }
  return { ambiguous: [...ambiguous], byId, count: elements.length };
}
