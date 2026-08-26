import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { PreviewCache } from "../../src/preview/index.js";

const roots: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-preview-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

it("stores preview bytes only behind a bounded opaque cache key", async () => {
  const root = await temporaryDirectory();
  const source = join(root, "source.png");
  const key = "a".repeat(64);
  await writeFile(source, "preview");
  const cache = new PreviewCache(join(root, "cache"));
  await cache.put(key, source, { height: 5, width: 7 }, 60_000);
  const entry = await cache.get(key);
  expect(entry?.metadata).toEqual({ height: 5, width: 7 });
  await expect(readFile(entry!.path, "utf8")).resolves.toBe("preview");
  await expect(cache.get("invalid")).rejects.toThrow("key is invalid");
});

it("expires cached previews and removes their server-owned copy", async () => {
  const root = await temporaryDirectory();
  const source = join(root, "source.png");
  const key = "b".repeat(64);
  await writeFile(source, "preview");
  const cache = new PreviewCache(join(root, "cache"));
  await cache.put(key, source, { height: 5, width: 7 }, 1);
  await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 10));
  expect(await cache.get(key)).toBeUndefined();
  await expect(stat(join(root, "cache", `${key}.png`))).rejects.toThrow();
});
