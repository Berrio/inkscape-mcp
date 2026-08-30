import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "./safe-dom.js";

const PUBLIC_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const URL_FRAGMENT = /url\(\s*(?:(['"])#([^'"]+)\1|#([^)]*?))\s*\)/giu;
const DIRECT_REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href"]);
const ID_LIST_ATTRIBUTES = new Set(["aria-describedby", "aria-labelledby"]);

export type SvgIdNormalizationOptions = {
  assignMissingIds?: boolean | undefined;
  prefix?: string | undefined;
};
export type SvgIdRename = {
  from?: string | undefined;
  reason: "duplicate" | "invalid" | "missing";
  to: string;
};
export type SvgIdNormalization = {
  renamed: readonly SvgIdRename[];
  svg: string;
};
export type SvgNativeQueryIdRemap = {
  /** Maps safe IDs emitted by the native query back to unique source IDs. */
  originalIdByNativeId: ReadonlyMap<string, string>;
  svg: string;
};

/** Normalizes IDs and the fragment references that can be rewritten safely. */
export function normalizeSvgIds(
  source: string,
  options: SvgIdNormalizationOptions = {},
): SvgIdNormalization {
  const prefix = normalizePrefix(options.prefix ?? "svg");
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(safe.svg, "image/svg+xml");
  const elements = Array.from(document.getElementsByTagName("*"));
  const used = new Set<string>();
  const firstRename = new Map<string, string>();
  const renamed: SvgIdRename[] = [];
  let sequence = 1;

  for (const element of elements) {
    const id = element.getAttribute("id");
    const shouldAssign = id === null && options.assignMissingIds === true;
    const valid = id !== null && PUBLIC_ID.test(id) && !used.has(id);
    if (!shouldAssign && valid) {
      used.add(id!);
      continue;
    }
    if (id === null && !shouldAssign) continue;
    const reason: SvgIdRename["reason"] =
      id === null ? "missing" : used.has(id) ? "duplicate" : "invalid";
    const next = nextId(
      prefix,
      element.localName ?? "element",
      used,
      () => sequence++,
    );
    element.setAttribute("id", next);
    used.add(next);
    if (id !== null && !firstRename.has(id)) firstRename.set(id, next);
    renamed.push({ ...(id === null ? {} : { from: id }), reason, to: next });
  }

  if (firstRename.size > 0) {
    for (const element of elements)
      rewriteSvgElementReferences(element, firstRename);
  }
  return {
    renamed,
    svg: new XMLSerializer().serializeToString(document),
  };
}

/**
 * Produces a private, safe-ID copy for a native `--query-all` invocation.
 * IDs duplicated in the original SVG deliberately have no reverse mapping:
 * returning no bound is safer than assigning one object's bound to another.
 */
export function remapSvgIdsForNativeQuery(
  source: string,
): SvgNativeQueryIdRemap {
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const document = new DOMParser().parseFromString(safe.svg, "image/svg+xml");
  const counts = new Map<string, number>();
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    const id = element.getAttribute("id");
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const normalized = normalizeSvgIds(safe.svg, {
    prefix: "inkscape_mcp_query",
  });
  const renamedByOriginal = new Map(
    normalized.renamed.flatMap((rename) =>
      rename.from === undefined ? [] : [[rename.from, rename.to] as const],
    ),
  );
  const originalIdByNativeId = new Map<string, string>();
  for (const [original, count] of counts) {
    if (count !== 1) continue;
    const native = renamedByOriginal.get(original) ?? original;
    originalIdByNativeId.set(native, original);
  }
  return { originalIdByNativeId, svg: normalized.svg };
}

/**
 * Rewrites only local fragment references represented by `renames` on one
 * already-trusted DOM element. Callers use this when cloning a bounded SVG
 * subtree so references outside that subtree are deliberately left intact.
 */
export function rewriteSvgElementReferences(
  element: XmlElement,
  renames: ReadonlyMap<string, string>,
): void {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    const rewritten = DIRECT_REFERENCE_ATTRIBUTES.has(name)
      ? rewriteDirectReference(value, renames)
      : ID_LIST_ATTRIBUTES.has(name)
        ? rewriteIdList(value, renames)
        : rewriteUrlFragments(value, renames);
    if (rewritten !== value) element.setAttribute(attribute.name, rewritten);
  }
  if (element.localName === "style" && element.textContent) {
    const rewritten = rewriteCssReferences(element.textContent, renames);
    if (rewritten !== element.textContent) element.textContent = rewritten;
  }
}

function rewriteCssReferences(
  value: string,
  renames: ReadonlyMap<string, string>,
): string {
  let rewritten = rewriteUrlFragments(value, renames);
  for (const [from, to] of renames) {
    for (const candidate of [from, cssEscapedIdentifier(from)]) {
      if (!candidate) continue;
      const selector = new RegExp(
        `#${escapeRegularExpression(candidate)}(?![A-Za-z0-9_-])`,
        "gu",
      );
      rewritten = rewritten.replace(selector, `#${to}`);
    }
  }
  return rewritten;
}

function rewriteDirectReference(
  value: string,
  renames: ReadonlyMap<string, string>,
): string {
  if (!value.startsWith("#")) return rewriteUrlFragments(value, renames);
  const replacement = renames.get(value.slice(1));
  return replacement === undefined ? value : `#${replacement}`;
}

function rewriteIdList(
  value: string,
  renames: ReadonlyMap<string, string>,
): string {
  return value
    .split(/\s+/u)
    .map((id) => renames.get(id) ?? id)
    .join(" ");
}

function rewriteUrlFragments(
  value: string,
  renames: ReadonlyMap<string, string>,
): string {
  return value.replace(
    URL_FRAGMENT,
    (
      full,
      _quote: string | undefined,
      quotedId: string | undefined,
      bareId: string | undefined,
    ) => {
      const id = (quotedId ?? bareId ?? "").trim();
      const replacement = renames.get(id);
      return replacement === undefined ? full : `url(#${replacement})`;
    },
  );
}

function normalizePrefix(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/gu, "_");
  if (!normalized || !/^[A-Za-z_]/u.test(normalized))
    throw new Error("ID prefix must start with a letter or underscore");
  return normalized.slice(0, 96);
}

function nextId(
  prefix: string,
  kind: string,
  used: ReadonlySet<string>,
  nextSequence: () => number,
): string {
  const normalizedKind = kind.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 24);
  for (;;) {
    const candidate = `${prefix}_${normalizedKind}_${nextSequence()}`.slice(
      0,
      128,
    );
    if (!used.has(candidate)) return candidate;
  }
}

function cssEscapedIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, (character) => `\\${character}`);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}
