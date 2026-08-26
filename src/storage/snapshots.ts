import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AtomicFileStore,
  assertRevision,
  RevisionConflictError,
  sha256File,
} from "./revisions.js";

type SnapshotRecord = {
  createdAt: number;
  expiresAt: number;
  owner: string;
  path: string;
  revision: string;
};
type SnapshotMetadata = Omit<SnapshotRecord, "path">;
export type Snapshot = { id: string; revision: string };
export type SnapshotRestore = { backupCreated: boolean; revision: string };

export class SnapshotStore {
  private readonly records = new Map<string, SnapshotRecord>();

  public constructor(
    private readonly root: string,
    private readonly fileStore = new AtomicFileStore(),
    private readonly maximumSnapshotsPerOwner = 100,
  ) {
    if (
      !Number.isInteger(maximumSnapshotsPerOwner) ||
      maximumSnapshotsPerOwner < 1
    )
      throw new Error("maximumSnapshotsPerOwner must be a positive integer");
  }

  public async create(
    sourcePath: string,
    owner: string,
    ttlMs: number,
    expectedRevision: string,
  ): Promise<Snapshot> {
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("ttlMs must be a positive integer");
    await assertSnapshotOwner(owner);
    await assertRevision(sourcePath, expectedRevision);
    await this.removeExpired();
    await this.enforceRetention(owner);
    await mkdir(resolve(this.root), { recursive: true });
    const id = `snap_${crypto.randomUUID().replaceAll("-", "")}`;
    const path = join(resolve(this.root), `${id}.svg`);
    await copyFile(sourcePath, path);
    const revision = await sha256File(path);
    if (revision !== expectedRevision) {
      await rm(path, { force: true });
      throw new RevisionConflictError(
        "Document revision changed while snapshotting",
      );
    }
    const record = {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      owner,
      path,
      revision,
    };
    try {
      await writeFile(
        this.metadataPath(id),
        JSON.stringify(toMetadata(record)),
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    this.records.set(id, record);
    return { id, revision };
  }

  public async restore(
    id: string,
    owner: string,
    targetPath: string,
    expectedRevision: string,
  ): Promise<SnapshotRestore> {
    const record = await this.get(id, owner);
    const result = await this.fileStore.commit({
      contents: await readFile(record.path),
      expectedRevision: record.revision,
      expectedOutputRevision: expectedRevision,
      sourcePath: record.path,
      targetPath,
    });
    return {
      backupCreated: result.backupPath !== undefined,
      revision: result.revision,
    };
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of await this.listRecords()) {
      if (record.expiresAt <= Date.now()) {
        await this.remove(id, record);
        removed += 1;
      }
    }
    return removed;
  }

  private async get(id: string, owner: string): Promise<SnapshotRecord> {
    const record = await this.load(id);
    if (!record || record.owner !== owner || record.expiresAt <= Date.now()) {
      if (record && record.expiresAt <= Date.now()) {
        await this.remove(id, record);
      }
      throw new RevisionConflictError("Snapshot is unavailable");
    }
    return record;
  }

  private async enforceRetention(owner: string): Promise<void> {
    const records = (await this.listRecords())
      .filter(([, record]) => record.owner === owner)
      .sort(([, left], [, right]) => left.createdAt - right.createdAt);
    while (records.length >= this.maximumSnapshotsPerOwner) {
      const oldest = records.shift();
      if (!oldest) break;
      await this.remove(oldest[0], oldest[1]);
    }
  }

  private async listRecords(): Promise<[string, SnapshotRecord][]> {
    const known = new Map(this.records);
    const root = resolve(this.root);
    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const match = /^(snap_[a-f0-9]{32})\.json$/u.exec(entry.name);
      if (!entry.isFile() || !match || known.has(match[1]!)) continue;
      const record = await this.load(match[1]!);
      if (record) known.set(match[1]!, record);
    }
    return [...known.entries()];
  }

  private async load(id: string): Promise<SnapshotRecord | undefined> {
    if (!/^snap_[a-f0-9]{32}$/u.test(id)) return undefined;
    const remembered = this.records.get(id);
    if (remembered) return remembered;
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.metadataPath(id), "utf8"),
      );
      if (!isMetadata(parsed)) return undefined;
      const record = { ...parsed, path: this.snapshotPath(id) };
      this.records.set(id, record);
      return record;
    } catch {
      return undefined;
    }
  }

  private async remove(id: string, record: SnapshotRecord): Promise<void> {
    await Promise.all([
      rm(record.path, { force: true }),
      rm(this.metadataPath(id), { force: true }),
    ]);
    this.records.delete(id);
  }

  private metadataPath(id: string): string {
    return join(resolve(this.root), `${id}.json`);
  }

  private snapshotPath(id: string): string {
    return join(resolve(this.root), `${id}.svg`);
  }
}

function assertSnapshotOwner(value: string): void {
  if (
    !value ||
    value.length > 256 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new Error("Snapshot owner is invalid");
}

function toMetadata(record: SnapshotRecord): SnapshotMetadata {
  return {
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    owner: record.owner,
    revision: record.revision,
  };
}

function isMetadata(value: unknown): value is SnapshotMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 4 &&
    Number.isSafeInteger(record.createdAt) &&
    Number.isSafeInteger(record.expiresAt) &&
    typeof record.owner === "string" &&
    typeof record.revision === "string" &&
    /^[a-f0-9]{64}$/u.test(record.revision)
  );
}
