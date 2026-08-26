import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import { sanitizeSvg, type SanitizeMode } from "../svg/index.js";
import {
  assertRevision,
  RevisionConflictError,
  sha256File,
} from "./revisions.js";

export type NativeInputDependency = {
  path: string;
  revision: string;
  uri: string;
};
export type NativeInputManifest = {
  dependencies: readonly NativeInputDependency[];
  source: { path: "input.svg"; revision: string };
};
export type NativeInputBundle = {
  /** Hash of the original workspace SVG, retained for optimistic concurrency. */
  revision: string;
  /** Hash of the rewritten staged SVG passed to the native process. */
  bundleRevision: string;
  manifest: NativeInputManifest;
  manifestPath: string;
  path: string;
  /** Rechecks source and linked dependencies immediately before publication. */
  assertCurrent: () => Promise<void>;
};
export type NativeInputBundleOptions = {
  /** Canonical workspace root. Dependencies may never resolve outside it. */
  allowedRoot?: string | undefined;
  /** Internal seam for deterministic race tests; it is never exposed by MCP. */
  beforeFinalVerification?: (() => Promise<void>) | undefined;
  maxDependencyBytes?: number | undefined;
  maximumSanitizeMode?: SanitizeMode | undefined;
};

type XmlAttribute = { name: string; value: string };
type XmlElement = {
  attributes: {
    item(index: number): XmlAttribute | null | undefined;
    length: number;
  };
  firstChild: XmlNode | null;
  localName: string;
  nextSibling: XmlNode | null;
  nodeType: number;
  setAttribute(name: string, value: string): void;
  textContent: string;
};
type XmlNode = XmlElement;
type LocalReference = {
  fragment: string;
  path: string;
  query: string;
  raw: string;
};
type StagedDependency = {
  originalPath: string;
  revision: string;
  stagedPath: string;
  uri: string;
};

/**
 * Creates a stable native input tree. The native process sees only a rewritten
 * SVG plus copied local dependencies, never a live workspace path.
 */
export async function createNativeInputBundle(
  sourcePath: string,
  expectedRevision: string,
  directory: string,
  options: NativeInputBundleOptions = {},
): Promise<NativeInputBundle> {
  const sourceCanonical = await realpath(sourcePath);
  const allowedRoot = await realpath(
    options.allowedRoot ?? dirname(sourceCanonical),
  );
  if (!isInside(allowedRoot, sourceCanonical))
    throw new RevisionConflictError("Native input source leaves its workspace");
  await assertRevision(sourceCanonical, expectedRevision);
  const source = await readFile(sourceCanonical, "utf8");
  const sanitization = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    maximumMode: options.maximumSanitizeMode ?? "preserve-local",
    mode:
      options.maximumSanitizeMode === "strict" ? "strict" : "preserve-local",
  });
  if (sanitization.removed.length > 0)
    throw new Error("Native export input violates the SVG safety policy");

  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(`Malformed SVG: ${message}`);
    },
  }).parseFromString(sanitization.svg, "image/svg+xml");
  const root = document.documentElement as unknown as XmlElement | null;
  if (!root || root.localName !== "svg") throw new Error("Malformed SVG input");
  const references = collectLocalReferences(root);
  const dependencies = await stageDependencies(
    references,
    sourceCanonical,
    allowedRoot,
    directory,
    options.maxDependencyBytes ?? 50 * 1024 * 1024,
  );
  rewriteReferences(root, dependencies);
  const path = join(directory, "input.svg");
  await writeFile(
    path,
    dependencies.length === 0
      ? source
      : new XMLSerializer().serializeToString(document),
    "utf8",
  );
  const bundleRevision = await sha256File(path);
  const manifest: NativeInputManifest = {
    dependencies: dependencies.map(({ revision, stagedPath, uri }) => ({
      path: stagedPath,
      revision,
      uri,
    })),
    source: { path: "input.svg", revision: expectedRevision },
  };
  const manifestPath = join(directory, "manifest.json");
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestContents, "utf8");
  const manifestRevision = sha256Text(manifestContents);

  const assertCurrent = async (): Promise<void> => {
    await assertRevision(sourceCanonical, expectedRevision);
    for (const dependency of dependencies)
      await assertRevision(dependency.originalPath, dependency.revision);
    if ((await sha256File(path)) !== bundleRevision)
      throw new RevisionConflictError("Native input bundle was modified");
    if ((await sha256File(manifestPath)) !== manifestRevision)
      throw new RevisionConflictError("Native input manifest was modified");
  };
  await options.beforeFinalVerification?.();
  await assertCurrent();
  return {
    assertCurrent,
    bundleRevision,
    manifest,
    manifestPath,
    path,
    revision: expectedRevision,
  };
}

function collectLocalReferences(root: XmlElement): readonly LocalReference[] {
  const references: LocalReference[] = [];
  for (const element of walk(root)) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      if (isDirectReferenceAttribute(attribute.name)) {
        const parsed = parseLocalReference(attribute.value);
        if (parsed) references.push(parsed);
      }
      references.push(...parseCssReferences(attribute.value));
    }
    if (element.localName.toLowerCase() === "style")
      references.push(...parseCssReferences(element.textContent));
  }
  return uniqueReferences(references);
}

async function stageDependencies(
  references: readonly LocalReference[],
  sourcePath: string,
  allowedRoot: string,
  directory: string,
  maxDependencyBytes: number,
): Promise<StagedDependency[]> {
  const dependencies: StagedDependency[] = [];
  const byPath = new Map<string, StagedDependency>();
  const assetsDirectory = join(directory, "assets");
  for (const reference of references) {
    if (isAbsolute(reference.path) || win32.isAbsolute(reference.path))
      throw new RevisionConflictError(
        "Native input dependency must be relative",
      );
    const candidate = resolve(dirname(sourcePath), reference.path);
    const canonical = await realpath(candidate).catch(() => {
      throw new RevisionConflictError("Native input dependency is unavailable");
    });
    if (!isInside(allowedRoot, canonical))
      throw new RevisionConflictError(
        "Native input dependency leaves workspace",
      );
    const metadata = await stat(canonical);
    if (!metadata.isFile())
      throw new RevisionConflictError("Native input dependency is not a file");
    if (
      !Number.isSafeInteger(maxDependencyBytes) ||
      maxDependencyBytes < 1 ||
      metadata.size > maxDependencyBytes
    )
      throw new RevisionConflictError(
        "Native input dependency exceeds size limit",
      );
    let dependency = byPath.get(canonical);
    if (!dependency) {
      const revision = await sha256File(canonical);
      const safeName = `${dependencies.length.toString().padStart(4, "0")}-${safeBasename(canonical)}`;
      const stagedPath = `assets/${safeName}`;
      const target = join(assetsDirectory, safeName);
      await mkdir(assetsDirectory, { recursive: true });
      await copyFile(canonical, target);
      if ((await sha256File(target)) !== revision)
        throw new RevisionConflictError(
          "Native input dependency changed while staging",
        );
      await assertRevision(canonical, revision);
      dependency = {
        originalPath: canonical,
        revision,
        stagedPath,
        uri: reference.path,
      };
      byPath.set(canonical, dependency);
      dependencies.push(dependency);
    }
  }
  return dependencies;
}

function rewriteReferences(
  root: XmlElement,
  dependencies: readonly StagedDependency[],
): void {
  const byOriginal = new Map<string, StagedDependency>();
  for (const dependency of dependencies)
    byOriginal.set(dependency.uri, dependency);
  for (const element of walk(root)) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      const value = isDirectReferenceAttribute(attribute.name)
        ? rewriteReference(attribute.value, byOriginal)
        : rewriteCssReferences(attribute.value, (reference) =>
            rewrittenUri(reference, byOriginal),
          );
      if (value !== attribute.value)
        element.setAttribute(attribute.name, value);
    }
    if (element.localName.toLowerCase() === "style")
      element.textContent = rewriteCssReferences(
        element.textContent,
        (reference) => rewrittenUri(reference, byOriginal),
      );
  }
}

function rewriteReference(
  value: string,
  dependencies: ReadonlyMap<string, StagedDependency>,
): string {
  const reference = parseLocalReference(value);
  return reference ? rewrittenUri(reference, dependencies) : value;
}
function rewrittenUri(
  reference: LocalReference,
  dependencies: ReadonlyMap<string, StagedDependency>,
): string {
  const dependency = dependencies.get(reference.path);
  if (!dependency) return reference.raw;
  return `${dependency.stagedPath}${reference.query}${reference.fragment}`;
}

function parseCssReferences(value: string): LocalReference[] {
  const references: LocalReference[] = [];
  for (const match of value.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/giu)) {
    const parsed = parseLocalReference(match[2] ?? "");
    if (parsed) references.push(parsed);
  }
  for (const match of value.matchAll(/@import\s+(['"])([^'"]+)\1/giu)) {
    const parsed = parseLocalReference(match[2] ?? "");
    if (parsed) references.push(parsed);
  }
  return references;
}
function rewriteCssReferences(
  value: string,
  rewrite: (reference: LocalReference) => string,
): string {
  return value
    .replace(
      /url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/giu,
      (whole, quote: string, raw: string) => {
        const parsed = parseLocalReference(raw);
        return parsed ? `url(${quote}${rewrite(parsed)}${quote})` : whole;
      },
    )
    .replace(
      /@import\s+(['"])([^'"]+)\1/giu,
      (whole, quote: string, raw: string) => {
        const parsed = parseLocalReference(raw);
        return parsed ? `@import ${quote}${rewrite(parsed)}${quote}` : whole;
      },
    );
}

function parseLocalReference(raw: string): LocalReference | undefined {
  const value = raw.trim();
  if (!value || value.startsWith("#")) return undefined;
  if (isSafeEmbeddedRasterDataUri(value)) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value))
    throw new RevisionConflictError("Native input dependency must be local");
  const fragmentIndex = value.indexOf("#");
  const beforeFragment =
    fragmentIndex < 0 ? value : value.slice(0, fragmentIndex);
  const queryIndex = beforeFragment.indexOf("?");
  const path =
    queryIndex < 0 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  if (!path) return undefined;
  return {
    fragment: fragmentIndex < 0 ? "" : value.slice(fragmentIndex),
    path,
    query: queryIndex < 0 ? "" : beforeFragment.slice(queryIndex),
    raw,
  };
}
function isSafeEmbeddedRasterDataUri(value: string): boolean {
  return /^data:image\/(?:gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/iu.test(
    value,
  );
}
function uniqueReferences(
  references: readonly LocalReference[],
): readonly LocalReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.path)) return false;
    seen.add(reference.path);
    return true;
  });
}
function isDirectReferenceAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "href" || normalized === "xlink:href" || normalized === "src"
  );
}
function safeBasename(path: string): string {
  return (
    basename(path)
      .replace(/[^A-Za-z0-9._-]/gu, "_")
      .slice(0, 120) || "asset"
  );
}
function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}
function* walk(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (let child = root.firstChild; child; child = child.nextSibling)
    if (child.nodeType === 1) yield* walk(child);
}
function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
