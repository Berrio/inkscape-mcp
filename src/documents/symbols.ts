import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

export type SvgSymbol = {
  id: string;
  viewBox?: readonly [number, number, number, number] | undefined;
};
export type SvgSymbolSpec = {
  id: string;
  sourceId: string;
  viewBox?: readonly [number, number, number, number] | undefined;
};
export type SvgUseCloneSpec = {
  id: string;
  sourceId: string;
  x?: number | undefined;
  y?: number | undefined;
};

/** Lists local SVG symbols. It intentionally exposes no arbitrary XML. */
export function listSvgSymbols(source: string): readonly SvgSymbol[] {
  const document = parseDocument(source);
  assertUseGraphAcyclic(document);
  return Array.from(document.getElementsByTagNameNS(SVG_NAMESPACE, "symbol"))
    .map((symbol) => ({
      id: requireId(symbol, "Symbol"),
      ...(symbol.hasAttribute("viewBox")
        ? { viewBox: parseViewBox(symbol.getAttribute("viewBox")!) }
        : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Creates a reusable symbol that safely references one existing local object. */
export function createSvgSymbol(source: string, spec: SvgSymbolSpec): string {
  validateSymbolSpec(spec);
  const document = parseDocument(source);
  assertUseGraphAcyclic(document);
  if (findById(document, spec.id)) throw new Error("Symbol ID already exists");
  const sourceElement = requireCloneSource(document, spec.sourceId);
  const symbol = document.createElementNS(SVG_NAMESPACE, "symbol");
  symbol.setAttribute("id", spec.id);
  if (spec.viewBox !== undefined)
    symbol.setAttribute("viewBox", spec.viewBox.join(" "));
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `#${sourceElement.getAttribute("id")}`);
  symbol.appendChild(use);
  ensureDefs(document).appendChild(symbol);
  return serialize(document);
}

/** Creates an explicit local SVG use clone and rejects malformed existing use cycles. */
export function createSvgUseClone(
  source: string,
  spec: SvgUseCloneSpec,
): string {
  validateCloneSpec(spec);
  const document = parseDocument(source);
  assertUseGraphAcyclic(document);
  if (findById(document, spec.id)) throw new Error("Clone ID already exists");
  requireCloneSource(document, spec.sourceId);
  const clone = document.createElementNS(SVG_NAMESPACE, "use");
  clone.setAttribute("id", spec.id);
  clone.setAttribute("href", `#${spec.sourceId}`);
  if (spec.x !== undefined) clone.setAttribute("x", String(spec.x));
  if (spec.y !== undefined) clone.setAttribute("y", String(spec.y));
  document.documentElement!.appendChild(clone);
  return serialize(document);
}

/** Deletes an unused symbol. Local use references are protected. */
export function deleteSvgSymbol(source: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Symbol ID is invalid");
  const document = parseDocument(source);
  assertUseGraphAcyclic(document);
  const symbol = findById(document, id);
  if (!symbol || symbol.localName !== "symbol")
    throw new Error("Symbol ID does not name an SVG symbol");
  for (const use of Array.from(
    document.getElementsByTagNameNS(SVG_NAMESPACE, "use"),
  )) {
    if (isDescendant(use, symbol)) continue;
    if (readLocalUseTarget(use) === id)
      throw new Error("Deleting this symbol would break an SVG use reference");
  }
  symbol.parentNode?.removeChild(symbol);
  return serialize(document);
}

function validateSymbolSpec(spec: SvgSymbolSpec): void {
  validateIds(spec.id, spec.sourceId);
  if (
    spec.viewBox !== undefined &&
    (!spec.viewBox.every(Number.isFinite) ||
      spec.viewBox[2] <= 0 ||
      spec.viewBox[3] <= 0)
  )
    throw new Error(
      "Symbol viewBox must be finite with positive width and height",
    );
}
function validateCloneSpec(spec: SvgUseCloneSpec): void {
  validateIds(spec.id, spec.sourceId);
  if (
    (spec.x !== undefined && !Number.isFinite(spec.x)) ||
    (spec.y !== undefined && !Number.isFinite(spec.y))
  )
    throw new Error("Clone coordinates must be finite");
}
function validateIds(id: string, sourceId: string): void {
  if (!SAFE_ID.test(id)) throw new Error("Symbol or clone ID is invalid");
  if (!SAFE_ID.test(sourceId)) throw new Error("Symbol source ID is invalid");
  if (id === sourceId)
    throw new Error("A symbol or clone cannot reference itself");
}
function parseDocument(source: string): XmlDocument {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before changing symbols or clones");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!document.documentElement || document.documentElement.localName !== "svg")
    throw new Error("SVG root is missing");
  return document;
}
function requireCloneSource(document: XmlDocument, id: string): XmlElement {
  const source = findById(document, id);
  if (!source) throw new Error("Symbol source ID does not exist");
  if (source.localName === "defs" || source.localName === "svg")
    throw new Error(
      "Symbol source must be a reusable SVG object, not a container",
    );
  return source;
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
function findById(document: XmlDocument, id: string): XmlElement | undefined {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.getAttribute("id") === id,
  );
}
function requireId(element: XmlElement, type: string): string {
  const id = element.getAttribute("id");
  if (!id || !SAFE_ID.test(id)) throw new Error(`${type} ID is invalid`);
  return id;
}
function parseViewBox(raw: string): readonly [number, number, number, number] {
  const values = raw.trim().split(/[ ,]+/u).map(Number);
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[2]! <= 0 ||
    values[3]! <= 0
  )
    throw new Error("Symbol viewBox is invalid");
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}
function assertUseGraphAcyclic(document: XmlDocument): void {
  const elements = Array.from(document.getElementsByTagName("*"));
  const byId = new Map(
    elements.flatMap((element) => {
      const id = element.getAttribute("id");
      return id === null ? [] : [[id, element] as const];
    }),
  );
  const state = new Map<string, "visiting" | "done">();
  const visit = (element: XmlElement): void => {
    const id = element.getAttribute("id");
    if (!id) return;
    const current = state.get(id);
    if (current === "visiting")
      throw new Error("SVG use references contain a cycle");
    if (current === "done") return;
    state.set(id, "visiting");
    const uses = [
      ...(element.localName === "use" ? [element] : []),
      ...Array.from(element.getElementsByTagNameNS(SVG_NAMESPACE, "use")),
    ];
    for (const use of uses) {
      const targetId = readLocalUseTarget(use);
      if (targetId === undefined) continue;
      const target = byId.get(targetId);
      if (!target) throw new Error("SVG use references a missing local ID");
      visit(target);
    }
    state.set(id, "done");
  };
  for (const element of elements)
    if (element.hasAttribute("id")) visit(element);
}
function readLocalUseTarget(use: XmlElement): string | undefined {
  const href = use.getAttribute("href");
  if (href === null) return undefined;
  if (!href.startsWith("#") || !SAFE_ID.test(href.slice(1)))
    throw new Error("SVG use references must be safe local IDs");
  return href.slice(1);
}
function isDescendant(element: XmlElement, ancestor: XmlElement): boolean {
  for (
    let parent = element.parentNode;
    parent?.nodeType === 1;
    parent = parent.parentNode
  )
    if (parent === ancestor) return true;
  return false;
}
function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}
