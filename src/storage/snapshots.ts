import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AtomicFileStore,
  RevisionConflictError,
  sha256File,
} from "./revisions.js";

type SnapshotRecord = {
  expiresAt: number;
  owner: string;
  path: string;
  revision: string;
};
export type Snapshot = { id: string; revision: string };

export class SnapshotStore {
  private readonly records = new Map<string, SnapshotRecord>();

  public constructor(
    private readonly root: string,
    private readonly fileStore = new AtomicFileStore(),
  ) {}

  public async create(
    sourcePath: string,
    owner: string,
    ttlMs: number,
  ): Promise<Snapshot> {
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("ttlMs must be a positive integer");
    await mkdir(resolve(this.root), { recursive: true });
    const id = `snap_${crypto.randomUUID().replaceAll("-", "")}`;
    const path = join(resolve(this.root), `${id}.svg`);
    await copyFile(sourcePath, path);
    const revision = await sha256File(path);
    this.records.set(id, {
      expiresAt: Date.now() + ttlMs,
      owner,
      path,
      revision,
    });
    return { id, revision };
  }

  public async restore(
    id: string,
    owner: string,
    targetPath: string,
    expectedRevision: string,
  ): Promise<string> {
    const record = await this.get(id, owner);
    const result = await this.fileStore.commit({
      contents: await readFile(record.path),
      expectedOutputRevision: expectedRevision,
      targetPath,
    });
    return result.revision;
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt <= Date.now()) {
        await rm(record.path, { force: true });
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private async get(id: string, owner: string): Promise<SnapshotRecord> {
    const record = this.records.get(id);
    if (!record || record.owner !== owner || record.expiresAt <= Date.now()) {
      if (record && record.expiresAt <= Date.now()) {
        await rm(record.path, { force: true });
        this.records.delete(id);
      }
      throw new RevisionConflictError("Snapshot is unavailable");
    }
    return record;
  }
}
