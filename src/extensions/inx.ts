import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

export type InxExporter = {
  id: string;
  name: string;
  outputExtension: string;
};

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
    .slice(0, 512);
  const exporters = await Promise.all(files.map(parseInxExporter));
  return exporters
    .filter((entry): entry is InxExporter => entry !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function parseInxExporter(
  path: string,
): Promise<InxExporter | undefined> {
  const text = await readFile(path, "utf8");
  if (text.length > 512 * 1024 || /<!DOCTYPE|<!ENTITY/iu.test(text))
    return undefined;
  const document = new DOMParser().parseFromString(text, "application/xml");
  const root = document.documentElement;
  if (!root || root.nodeName !== "inkscape-extension") return undefined;
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
    id.length > 256 ||
    name.length > 256
  )
    return undefined;
  return { id, name, outputExtension: extension };
}

function childElement(
  parent: Node | undefined,
  name: string,
): Element | undefined {
  return Array.from(parent?.childNodes ?? []).find(
    (node): node is Element => node.nodeType === 1 && node.nodeName === name,
  );
}
