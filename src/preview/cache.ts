import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type PreviewCacheMetadata = {
  dpiX?: number;
  dpiY?: number;
  height: number;
  width: number;
};
export type PreviewCacheEntry = {
  metadata: PreviewCacheMetadata;
  path: string;
};
type CacheRecord = PreviewCacheEntry & { expiresAt: number };

const CACHE_KEY = /^[a-f0-9]{64}$/u;

/** Disk-backed bounded preview cache. Cache files are server-owned and never
 * exposed as paths; callers receive only a cache hit plus their artifact URI. */
export class PreviewCache {
  private readonly records = new Map<string, CacheRecord>();

  public constructor(private readonly root: string) {}

  public async get(key: string): Promise<PreviewCacheEntry | undefined> {
    validateKey(key);
    const record = this.records.get(key);
    if (!record || record.expiresAt <= Date.now()) {
      if (record) await this.remove(key, record);
      return undefined;
    }
    try {
      const metadata = await stat(record.path);
      if (!metadata.isFile() || metadata.size < 1) {
        await this.remove(key, record);
        return undefined;
      }
      return { metadata: record.metadata, path: record.path };
    } catch {
      await this.remove(key, record);
      return undefined;
    }
  }

  public async put(
    key: string,
    sourcePath: string,
    metadata: PreviewCacheMetadata,
    ttlMs: number,
  ): Promise<void> {
    validateKey(key);
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("Preview cache TTL must be a positive integer");
    const root = resolve(this.root);
    await mkdir(root, { recursive: true });
    const path = join(root, `${key}.png`);
    const temporaryPath = join(root, `${key}.${crypto.randomUUID()}.tmp`);
    await copyFile(sourcePath, temporaryPath);
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    this.records.set(key, {
      expiresAt: Date.now() + ttlMs,
      metadata: { ...metadata },
      path,
    });
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [key, record] of this.records)
      if (record.expiresAt <= Date.now()) {
        await this.remove(key, record);
        removed += 1;
      }
    return removed;
  }

  private async remove(key: string, record: CacheRecord): Promise<void> {
    this.records.delete(key);
    await rm(record.path, { force: true });
  }
}

function validateKey(key: string): void {
  if (!CACHE_KEY.test(key)) throw new Error("Preview cache key is invalid");
}
