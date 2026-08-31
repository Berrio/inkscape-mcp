import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { RevisionConflictError, sha256File } from "./revisions.js";

type ArtifactRecord = {
  batchId?: string;
  expiresAt: number;
  hash: string;
  metadata?: ArtifactMetadata;
  owner: string;
  path: string;
  size: number;
};
export type ArtifactMetadata = {
  contentType?: string;
  export?: {
    format:
      | "emf"
      | "eps"
      | "pdf"
      | "plain-svg"
      | "png"
      | "ps"
      | "svg"
      | "svgz"
      | "wmf"
      | "xaml";
    verified: boolean;
  };
};
export type Artifact = {
  batchId?: string;
  hash: string;
  id: string;
  metadata?: ArtifactMetadata;
  size: number;
  uri: string;
};
export type ArtifactPublishRequest = {
  metadata?: ArtifactMetadata;
  sourcePath: string;
};
export type ArtifactBatch = { artifacts: readonly Artifact[]; id: string };

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
    metadata?: ArtifactMetadata,
  ): Promise<Artifact> {
    const safeMetadata =
      metadata === undefined ? undefined : sanitizeMetadata(metadata);
    const sourceMetadata = await stat(sourcePath);
    if (!sourceMetadata.isFile() || sourceMetadata.size > this.maxArtifactBytes)
      throw new RevisionConflictError("Artifact exceeds allowed size");
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("ttlMs must be a positive integer");
    await mkdir(resolve(this.root), { recursive: true });
    const id = `art_${crypto.randomUUID().replaceAll("-", "")}`;
    const path = join(resolve(this.root), id);
    await copyFile(sourcePath, path);
    const staged = await stat(path);
    if (!staged.isFile() || staged.size > this.maxArtifactBytes) {
      await rm(path, { force: true });
      throw new RevisionConflictError("Artifact exceeds allowed size");
    }
    const hash = await sha256File(path);
    this.records.set(id, {
      expiresAt: Date.now() + ttlMs,
      hash,
      ...(safeMetadata === undefined ? {} : { metadata: safeMetadata }),
      owner,
      path,
      size: staged.size,
    });
    return {
      hash,
      id,
      ...(safeMetadata === undefined ? {} : { metadata: safeMetadata }),
      size: staged.size,
      uri: `inkscape://artifact/${id}`,
    };
  }

  /** Publishes a logical batch and rolls back already published copies if any
   * member fails. It is not advertised as crash-atomic; F05's final publisher
   * chooses directory rename or a manifest commit strategy. */
  public async publishBatch(
    requests: readonly ArtifactPublishRequest[],
    owner: string,
    ttlMs: number,
  ): Promise<ArtifactBatch> {
    if (requests.length < 1 || requests.length > 1_000)
      throw new Error("Artifact batch size is out of range");
    const id = `batch_${crypto.randomUUID().replaceAll("-", "")}`;
    const published: Artifact[] = [];
    try {
      for (const request of requests) {
        const artifact = await this.publish(
          request.sourcePath,
          owner,
          ttlMs,
          request.metadata,
        );
        const record = this.records.get(artifact.id);
        if (!record)
          throw new Error("Published artifact record is unavailable");
        record.batchId = id;
        published.push({ ...artifact, batchId: id });
      }
      return { artifacts: published, id };
    } catch (error) {
      await Promise.all(published.map((artifact) => this.remove(artifact.id)));
      throw error;
    }
  }

  public async readChunk(
    id: string,
    owner: string,
    offset: number,
    length: number,
    maximumReadBytes: number,
  ): Promise<{ bytes: Buffer; hash: string; size: number }> {
    const record = await this.get(id, owner);
    return this.read(record, offset, length, maximumReadBytes);
  }

  /**
   * Reads an opaque artifact URI capability. This is used only by the MCP
   * resource adapter: the random artifact ID is the capability, while tools
   * continue to use the owner-bound method above.
   */
  public async readCapabilityChunk(
    id: string,
    offset: number,
    length: number,
    maximumReadBytes: number,
  ): Promise<{ bytes: Buffer; hash: string; size: number }> {
    const record = await this.get(id);
    return this.read(record, offset, length, maximumReadBytes);
  }

  /** Restricts an opaque URI capability to a trusted principal scope. */
  public async readScopedCapabilityChunk(
    id: string,
    owns: (owner: string) => boolean,
    offset: number,
    length: number,
    maximumReadBytes: number,
  ): Promise<{ bytes: Buffer; hash: string; size: number }> {
    const record = await this.get(id);
    if (!owns(record.owner))
      throw new RevisionConflictError("Artifact is unavailable");
    return this.read(record, offset, length, maximumReadBytes);
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records)
      if (record.expiresAt <= Date.now()) {
        await this.remove(id);
        removed += 1;
      }
    return removed;
  }

  private async get(id: string, owner?: string): Promise<ArtifactRecord> {
    const record = this.records.get(id);
    if (
      !record ||
      (owner !== undefined && record.owner !== owner) ||
      record.expiresAt <= Date.now()
    )
      throw new RevisionConflictError("Artifact is unavailable");
    return record;
  }

  private async remove(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    await rm(record.path, { force: true });
  }

  private async read(
    record: ArtifactRecord,
    offset: number,
    length: number,
    maximumReadBytes: number,
  ): Promise<{ bytes: Buffer; hash: string; size: number }> {
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
}

function sanitizeMetadata(metadata: ArtifactMetadata): ArtifactMetadata {
  if (
    (metadata.contentType !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u.test(
        metadata.contentType,
      )) ||
    (metadata.export !== undefined &&
      (typeof metadata.export.verified !== "boolean" ||
        !/^(?:emf|eps|pdf|plain-svg|png|ps|svg|svgz|wmf|xaml)$/u.test(
          metadata.export.format,
        )))
  )
    throw new Error("Artifact metadata is invalid");
  return {
    ...(metadata.contentType === undefined
      ? {}
      : { contentType: metadata.contentType }),
    ...(metadata.export === undefined
      ? {}
      : { export: { ...metadata.export } }),
  };
}
