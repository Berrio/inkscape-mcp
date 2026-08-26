import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";

import { normalizeSvgIds, sanitizeSvg } from "../svg/index.js";

const SVG = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const REF = /(?:url\(\s*#|^#)([A-Za-z_][A-Za-z0-9_.-]{0,127})/gu;

/** Produces an autonomous SVG for selected elements and their local references. */
export function extractSvgSelection(
  source: string,
  ids: readonly string[],
): { ids: readonly string[]; svg: string; warnings: readonly string[] } {
  if (ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length)
    throw new Error("Selection export IDs are invalid");
  if (ids.some((id) => !SAFE_ID.test(id)))
    throw new Error("Selection export ID is invalid");
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (safe.removed.length > 0)
    throw new Error("SVG must be sanitized before selection export");
  const input = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = input.documentElement;
  if (!root || root.localName !== "svg") throw new Error("SVG root is missing");
  if (input.getElementsByTagName("style").length > 0)
    throw new Error("Selection export does not yet support stylesheet closure");
  const all = Array.from(input.getElementsByTagName("*"));
  const byId = new Map(
    all.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [[id, element] as const];
    }),
  );
  const selected = ids.map((id) => {
    const element = byId.get(id);
    if (!element) throw new Error("Selected SVG element does not exist");
    return element;
  });
  const selectedRoots = selected.filter(
    (element) =>
      !selected.some(
        (other) => other !== element && isDescendantOf(element, other),
      ),
  );
  const output = new DOMParser().parseFromString(
    `<svg xmlns="${SVG}"/>`,
    "image/svg+xml",
  );
  const target = output.documentElement!;
  for (let index = 0; index < root.attributes.length; index += 1) {
    const attribute = root.attributes.item(index);
    if (attribute) target.setAttribute(attribute.name, attribute.value);
  }
  const references = (element: XmlElement): string[] => {
    const found = new Set<string>();
    const visit = (current: XmlElement): void => {
      for (let index = 0; index < current.attributes.length; index += 1) {
        const attribute = current.attributes.item(index);
        if (!attribute) continue;
        for (const match of attribute.value.matchAll(REF)) found.add(match[1]!);
      }
      for (let index = 0; index < current.childNodes.length; index += 1) {
        const child = current.childNodes.item(index);
        if (child && child.nodeType === child.ELEMENT_NODE)
          visit(child as XmlElement);
      }
    };
    visit(element);
    return [...found];
  };
  const selectedIds = new Set(
    selectedRoots.flatMap((element) =>
      Array.from(element.getElementsByTagName("*")).flatMap((descendant) => {
        const id = descendant.getAttribute("id");
        return id === null ? [] : [id];
      }),
    ),
  );
  for (const rootElement of selectedRoots) {
    const ownId = rootElement.getAttribute("id");
    if (ownId) selectedIds.add(ownId);
  }
  const dependencyIds = new Set<string>();
  const resolving = new Set<string>();
  const resolved = new Set<string>();
  const includeDependency = (id: string): void => {
    if (selectedIds.has(id) || resolved.has(id)) return;
    if (resolving.has(id))
      throw new Error("Selection export has a cyclic reference");
    const dependency = byId.get(id);
    if (!dependency)
      throw new Error("Selection export has an unresolved reference");
    resolving.add(id);
    for (const reference of references(dependency))
      includeDependency(reference);
    resolving.delete(id);
    resolved.add(id);
    dependencyIds.add(id);
  };
  for (const element of selectedRoots) {
    for (const reference of references(element)) includeDependency(reference);
    forEachAncestor(element, root, (ancestor) => {
      for (const reference of references(ancestor))
        includeDependency(reference);
    });
  }
  const defs = output.createElementNS(SVG, "defs");
  const dependencyRoots = [...dependencyIds]
    .map((id) => byId.get(id)!)
    .filter(
      (element) =>
        ![...dependencyIds].some(
          (id) =>
            id !== element.getAttribute("id") &&
            isDescendantOf(element, byId.get(id)!),
        ),
    );
  for (const dependency of dependencyRoots) {
    defs.appendChild(dependency.cloneNode(true));
  }
  if (defs.childNodes.length > 0) target.appendChild(defs);
  for (const element of selectedRoots)
    target.appendChild(cloneWithAncestors(element, root));
  const normalized = normalizeSvgIds(
    new XMLSerializer().serializeToString(output),
    {
      prefix: "selection",
    },
  );
  return { ids: [...ids], svg: normalized.svg, warnings: [] };
}

function isDescendantOf(element: XmlElement, ancestor: XmlElement): boolean {
  let parent = element.parentNode;
  while (parent) {
    if (parent === ancestor) return true;
    parent = parent.parentNode;
  }
  return false;
}

function forEachAncestor(
  element: XmlElement,
  root: XmlElement,
  visit: (ancestor: XmlElement) => void,
): void {
  let parent = element.parentNode;
  while (parent && parent !== root) {
    if (parent.nodeType === parent.ELEMENT_NODE) visit(parent as XmlElement);
    parent = parent.parentNode;
  }
}

function cloneWithAncestors(element: XmlElement, root: XmlElement): XmlNode {
  const ancestors: XmlElement[] = [];
  forEachAncestor(element, root, (ancestor) => ancestors.push(ancestor));
  let cloned = element.cloneNode(true);
  for (const ancestor of ancestors.reverse()) {
    const wrapper = ancestor.cloneNode(false) as XmlElement;
    wrapper.removeAttribute("id");
    wrapper.appendChild(cloned);
    cloned = wrapper;
  }
  return cloned;
}
