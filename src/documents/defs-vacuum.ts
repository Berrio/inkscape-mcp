import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type UnusedDefsPlan = {
  candidateIds: readonly string[];
  removedIds: readonly string[];
};

/**
 * Finds unused, top-level <defs> resources.  It deliberately leaves anonymous
 * nodes and nested resources alone: this is a conservative cleanup, not an
 * optimizer that rewrites SVG semantics.
 */
export function planUnusedSvgDefs(source: string): UnusedDefsPlan {
  const document = parseDocument(source);
  const candidates = directDefinitionElements(document).filter(
    (element) => element.getAttribute("id") !== null,
  );
  const candidateIds = candidates.map((element) => element.getAttribute("id")!);
  const removable = new Set(candidateIds);
  let changed = true;
  while (changed) {
    changed = false;
    const referenced = collectReferences(
      document,
      candidates,
      candidates.filter(
        (element) => !removable.has(element.getAttribute("id")!),
      ),
    );
    for (const id of removable) {
      if (!referenced.has(id)) continue;
      removable.delete(id);
      changed = true;
    }
  }
  return {
    candidateIds,
    removedIds: candidateIds.filter((id) => removable.has(id)),
  };
}

export function vacuumUnusedSvgDefs(source: string): {
  plan: UnusedDefsPlan;
  svg: string;
} {
  const document = parseDocument(source);
  const plan = planUnusedSvgDefs(source);
  if (plan.removedIds.length === 0)
    return { plan, svg: new XMLSerializer().serializeToString(document) };
  const removed = new Set(plan.removedIds);
  for (const element of directDefinitionElements(document)) {
    if (removed.has(element.getAttribute("id") ?? ""))
      element.parentNode?.removeChild(element);
  }
  for (const defs of Array.from(document.getElementsByTagName("defs"))) {
    if (!defs.firstChild) defs.parentNode?.removeChild(defs);
  }
  return { plan, svg: new XMLSerializer().serializeToString(document) };
}

function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before vacuuming definitions");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}

function directDefinitionElements(document: XmlDocument): XmlElement[] {
  return Array.from(document.getElementsByTagName("defs")).flatMap((defs) =>
    Array.from(defs.childNodes).filter(
      (node): node is XmlElement => node.nodeType === 1,
    ),
  );
}

function collectReferences(
  document: XmlDocument,
  definitions: readonly XmlElement[],
  keptDefinitions: readonly XmlElement[],
): Set<string> {
  const kept = new Set(keptDefinitions);
  const references = new Set<string>();
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (isWithinRemovedDefinition(element, definitions, kept)) continue;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (attribute) collectReferencesFromValue(attribute.value, references);
    }
    if (element.localName === "style")
      collectReferencesFromValue(element.textContent ?? "", references);
  }
  return references;
}

function isWithinRemovedDefinition(
  element: XmlElement,
  definitions: readonly XmlElement[],
  kept: ReadonlySet<XmlElement>,
): boolean {
  for (let parent: XmlElement | null = element; parent;) {
    if (definitions.includes(parent)) return !kept.has(parent);
    if (parent.parentNode?.nodeType !== 1) return false;
    parent = parent.parentNode as XmlElement;
  }
  return false;
}

function collectReferencesFromValue(
  value: string,
  references: Set<string>,
): void {
  for (const match of value.matchAll(
    /url\(\s*(?:['"])?#([A-Za-z_][A-Za-z0-9_.:-]*)(?:['"])?\s*\)/giu,
  ))
    references.add(match[1]!);
  const fragment = /^\s*#([A-Za-z_][A-Za-z0-9_.:-]*)\s*$/u.exec(value);
  if (fragment) references.add(fragment[1]!);
}
