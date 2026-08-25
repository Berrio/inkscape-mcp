import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { RevisionConflictError, sha256File } from "./revisions.js";

type ArtifactRecord = {
  expiresAt: number;
  hash: string;
  owner: string;
  path: string;
  size: number;
};
export type Artifact = { hash: string; id: string; size: number; uri: string };

export class ArtifactStore {
  private readonly records = new Map<string, ArtifactRecord>();

  public constructor(
    private readonly root: string,
    private readonly maxArtifactBytes: number,
  ) {}

  public async publish(
    sourcePath: string,
    owner: string,
    ttlMs: number,
  ): Promise<Artifact> {
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size > this.maxArtifactBytes)
      throw new RevisionConflictError("Artifact exceeds allowed size");
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("ttlMs must be a positive integer");
    await mkdir(resolve(this.root), { recursive: true });
    const id = `art_${crypto.randomUUID().replaceAll("-", "")}`;
    const path = join(resolve(this.root), id);
    await copyFile(sourcePath, path);
    const hash = await sha256File(path);
    this.records.set(id, {
      expiresAt: Date.now() + ttlMs,
      hash,
      owner,
      path,
      size: metadata.size,
    });
    return { hash, id, size: metadata.size, uri: `inkscape://artifact/${id}` };
  }

  public async readChunk(
    id: string,
    owner: string,
    offset: number,
    length: number,
    maximumReadBytes: number,
  ): Promise<{ bytes: Buffer; hash: string; size: number }> {
    const record = await this.get(id, owner);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > maximumReadBytes
    )
      throw new RevisionConflictError("Invalid artifact chunk range");
    if (offset >= record.size)
      return { bytes: Buffer.alloc(0), hash: record.hash, size: record.size };
    const bytes = Buffer.alloc(Math.min(length, record.size - offset));
    const handle = await open(record.path, "r");
    try {
      await handle.read(bytes, 0, bytes.byteLength, offset);
    } finally {
      await handle.close();
    }
    return { bytes, hash: record.hash, size: record.size };
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records)
      if (record.expiresAt <= Date.now()) {
        await rm(record.path, { force: true });
        this.records.delete(id);
        removed += 1;
      }
    return removed;
  }

  private async get(id: string, owner: string): Promise<ArtifactRecord> {
    const record = this.records.get(id);
    if (!record || record.owner !== owner || record.expiresAt <= Date.now())
      throw new RevisionConflictError("Artifact is unavailable");
    return record;
  }
}
