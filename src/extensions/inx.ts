import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

export type InxExporter = {
  id: string;
  name: string;
  outputExtension: string;
};

const MAX_INX_BYTES = 512 * 1024;
const MAX_INX_FILES = 512;

/** Reads only server-owned INX directories; no client path or extension ID enters here. */
export async function discoverInxExporters(
  extensionDirectories: readonly string[],
): Promise<readonly InxExporter[]> {
  const files = (
    await Promise.all(
      [...new Set(extensionDirectories)].map(async (directory) => {
        try {
          return (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith(".inx"))
            .map((entry) => join(directory, entry.name));
        } catch {
          return [];
        }
      }),
    )
  )
    .flat()
    .sort()
    .slice(0, MAX_INX_FILES);
  const exporters: InxExporter[] = [];
  for (const file of files) {
    const exporter = await parseInxExporter(file);
    if (exporter !== undefined) exporters.push(exporter);
  }
  return exporters.sort((left, right) => left.id.localeCompare(right.id));
}

async function parseInxExporter(
  path: string,
): Promise<InxExporter | undefined> {
  try {
    const text = await readBoundedInx(path);
    if (text === undefined || /<!DOCTYPE|<!ENTITY/iu.test(text))
      return undefined;
    let malformed = false;
    const document = new DOMParser({
      onError: (level) => {
        if (level !== "warning") malformed = true;
      },
    }).parseFromString(text, "application/xml");
    const root = document.documentElement;
    if (malformed || !root || root.nodeName !== "inkscape-extension")
      return undefined;
    const output = childElement(root, "output");
    const id = childElement(root, "id")?.textContent?.trim();
    const extension = childElement(output, "extension")
      ?.textContent?.trim()
      .replace(/^\./u, "")
      .toLowerCase();
    const name = childElement(root, "name")?.textContent?.trim();
    if (
      !id ||
      !name ||
      !extension ||
      !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(extension) ||
      !/^[a-z0-9][a-z0-9.:-]{0,255}$/iu.test(id) ||
      name.length > 256
    )
      return undefined;
    return { id, name, outputExtension: extension };
  } catch {
    return undefined;
  }
}

/** Reads one more byte than the limit so an oversized manifest is never decoded. */
async function readBoundedInx(path: string): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_INX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_INX_BYTES) return undefined;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function childElement(
  parent: Node | undefined,
  name: string,
): Element | undefined {
  return Array.from(parent?.childNodes ?? []).find(
    (node): node is Element => node.nodeType === 1 && node.nodeName === name,
  );
}
