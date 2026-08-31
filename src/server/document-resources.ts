import { readFile, stat } from "node:fs/promises";

import { RevisionConflictError, sha256File } from "../storage/index.js";

export type DocumentResource = {
  id: string;
  metadataUri: string;
  summaryUri: string;
  svgUri: string;
};
export type DocumentResourceKind = "metadata" | "summary" | "svg";
export type ExportManifestResource = { id: string; uri: string };

type DocumentResourceRecord = {
  absolutePath: string;
  expiresAt: number;
  metadata: string;
  owner: string;
  revision: string;
  summary: string;
};
type ExportManifestResourceRecord = {
  expiresAt: number;
  jobId: string;
  owner: string;
};

/**
 * Issues unguessable, short-lived document resource capabilities. Records keep
 * private filesystem paths only in process memory; every resource read checks
 * that the document still has the revision it was registered with.
 */
export class DocumentResourceStore {
  private readonly records = new Map<string, DocumentResourceRecord>();

  public constructor(private readonly defaultTtlMs = 10 * 60_000) {}

  public register(input: {
    absolutePath: string;
    metadata: unknown;
    owner: string;
    revision: string;
    summary: unknown;
    ttlMs?: number;
  }): DocumentResource {
    const ttlMs = input.ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("Document resource TTL is invalid");
    const id = `doc_${crypto.randomUUID().replaceAll("-", "")}`;
    this.records.set(id, {
      absolutePath: input.absolutePath,
      expiresAt: Date.now() + ttlMs,
      metadata: JSON.stringify(input.metadata),
      owner: input.owner,
      revision: input.revision,
      summary: JSON.stringify(input.summary),
    });
    return {
      id,
      metadataUri: `inkscape://document/${id}/metadata`,
      summaryUri: `inkscape://document/${id}/summary`,
      svgUri: `inkscape://document/${id}/svg`,
    };
  }

  public async readCapability(
    id: string,
    kind: DocumentResourceKind,
    maximumReadBytes: number,
  ): Promise<{ mimeType: string; text: string }> {
    const record = await this.require(id);
    if ((await sha256File(record.absolutePath)) !== record.revision)
      throw new RevisionConflictError(
        "Document resource revision is unavailable",
      );
    const text =
      kind === "metadata"
        ? record.metadata
        : kind === "summary"
          ? record.summary
          : await this.readSvg(record.absolutePath, maximumReadBytes);
    if (Buffer.byteLength(text, "utf8") > maximumReadBytes)
      throw new RevisionConflictError("Document resource exceeds read limit");
    return {
      mimeType: kind === "svg" ? "image/svg+xml" : "application/json",
      text,
    };
  }

  /** Used by owner-bound domain operations; resource URIs remain capabilities. */
  public async readOwned(
    id: string,
    owner: string,
    kind: DocumentResourceKind,
    maximumReadBytes: number,
  ): Promise<{ mimeType: string; text: string }> {
    const record = this.records.get(id);
    if (record?.owner !== owner)
      throw new RevisionConflictError("Document resource is unavailable");
    return this.readCapability(id, kind, maximumReadBytes);
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records)
      if (record.expiresAt <= Date.now()) {
        this.records.delete(id);
        removed += 1;
      }
    return removed;
  }

  private async require(id: string): Promise<DocumentResourceRecord> {
    const record = this.records.get(id);
    if (!record || record.expiresAt <= Date.now())
      throw new RevisionConflictError("Document resource is unavailable");
    return record;
  }

  private async readSvg(
    path: string,
    maximumReadBytes: number,
  ): Promise<string> {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > maximumReadBytes)
      throw new RevisionConflictError(
        "Document SVG resource exceeds read limit",
      );
    return readFile(path, "utf8");
  }
}

/** Opaque, short-lived references to a job's completed export manifest. */
export class ExportManifestResourceStore {
  private readonly records = new Map<string, ExportManifestResourceRecord>();

  public constructor(private readonly defaultTtlMs = 24 * 60 * 60_000) {}

  public register(
    jobId: string,
    owner: string,
    ttlMs = this.defaultTtlMs,
  ): ExportManifestResource {
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("Export manifest resource TTL is invalid");
    const id = `exp_${crypto.randomUUID().replaceAll("-", "")}`;
    this.records.set(id, { expiresAt: Date.now() + ttlMs, jobId, owner });
    return { id, uri: `inkscape://export/${id}/manifest` };
  }

  public async resolve(id: string): Promise<{ jobId: string; owner: string }> {
    const record = this.records.get(id);
    if (!record || record.expiresAt <= Date.now())
      throw new RevisionConflictError(
        "Export manifest resource is unavailable",
      );
    return { jobId: record.jobId, owner: record.owner };
  }

  public async removeExpired(): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records)
      if (record.expiresAt <= Date.now()) {
        this.records.delete(id);
        removed += 1;
      }
    return removed;
  }
}
