import { mkdtemp, opendir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PREFIX = "inkscape-mcp-";
export const DEFAULT_STALE_SCRATCH_AGE_MS = 24 * 60 * 60 * 1_000;

export class ScratchManager {
  public constructor(private readonly root: string = tmpdir()) {}

  public async create(kind: "job" | "probe" | "staging"): Promise<string> {
    return mkdtemp(join(resolve(this.root), `${PREFIX}${kind}-`));
  }

  public async withDirectory<T>(
    kind: "job" | "probe" | "staging",
    action: (directory: string) => Promise<T>,
  ): Promise<T> {
    const directory = await this.create(kind);
    try {
      return await action(directory);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  public async cleanupStale(maxAgeMs: number): Promise<number> {
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 0) {
      throw new Error("maxAgeMs must be a non-negative integer");
    }
    const canonicalRoot = resolve(this.root);
    let directory;
    try {
      directory = await opendir(canonicalRoot);
    } catch {
      return 0;
    }
    let removed = 0;
    for await (const entry of directory) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !entry.name.startsWith(PREFIX)
      ) {
        continue;
      }
      const path = join(canonicalRoot, entry.name);
      const metadata = await stat(path).catch(() => undefined);
      if (metadata && Date.now() - metadata.mtimeMs > maxAgeMs) {
        await rm(path, { force: true, recursive: true });
        removed += 1;
      }
    }
    return removed;
  }
}

/** Removes only stale server-owned scratch directories before a new local
 * server starts. The age avoids deleting work from another live process. */
export async function recoverStaleScratch(
  root?: string,
  maxAgeMs = DEFAULT_STALE_SCRATCH_AGE_MS,
): Promise<number> {
  return new ScratchManager(root).cleanupStale(maxAgeMs);
}
