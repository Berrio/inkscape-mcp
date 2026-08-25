import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type MutationDocumentRef = { expectedRevision: string; uri: string };

export class RevisionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RevisionConflictError";
  }
}

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk: Buffer) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", () => resolveHash(hash.digest("hex")));
  });
}

export async function assertRevision(
  path: string,
  expectedRevision: string,
): Promise<void> {
  const actual = await sha256File(path);
  if (actual !== expectedRevision) {
    throw new RevisionConflictError("Document revision no longer matches");
  }
}

export class CanonicalPathLocks {
  private readonly tails = new Map<string, Promise<void>>();

  public async acquire(paths: readonly string[]): Promise<() => void> {
    const keys = [
      ...new Set(paths.map((path) => resolve(path).toLocaleLowerCase())),
    ].sort();
    const releases: (() => void)[] = [];
    for (const key of keys) {
      const prior = this.tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolveCurrent) => {
        release = resolveCurrent;
      });
      const tail = prior.then(() => current);
      this.tails.set(key, tail);
      await prior;
      releases.push(() => {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    }
    return () => {
      for (const release of releases.reverse()) release();
    };
  }

  public async withLocks<T>(
    paths: readonly string[],
    action: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(paths);
    try {
      return await action();
    } finally {
      release();
    }
  }
}

export type CommitFileRequest = {
  contents: Uint8Array;
  expectedOutputRevision?: string;
  expectedRevision?: string;
  sourcePath?: string;
  targetPath: string;
};
export type CommitFileResult = { backupPath?: string; revision: string };

export class AtomicFileStore {
  public constructor(private readonly locks = new CanonicalPathLocks()) {}

  public async commit(request: CommitFileRequest): Promise<CommitFileResult> {
    const target = resolve(request.targetPath);
    return this.locks.withLocks(
      [target, ...(request.sourcePath ? [request.sourcePath] : [])],
      async () => {
        if (request.sourcePath && request.expectedRevision)
          await assertRevision(request.sourcePath, request.expectedRevision);
        const exists = await fileExists(target);
        if (exists && request.expectedOutputRevision === undefined)
          throw new RevisionConflictError(
            "Overwriting an output requires expectedOutputRevision",
          );
        if (exists && request.expectedOutputRevision)
          await assertRevision(target, request.expectedOutputRevision);
        const temporary = join(
          dirname(target),
          `.${basename(target)}.inkscape-mcp-${crypto.randomUUID()}.tmp`,
        );
        let backupPath: string | undefined;
        try {
          const handle = await open(temporary, "wx");
          try {
            await handle.writeFile(request.contents);
            await handle.sync();
          } finally {
            await handle.close();
          }
          if (exists) {
            backupPath = uniqueBackupPath(target);
            await copyFile(target, backupPath, 0);
          }
          await rename(temporary, target);
          return {
            ...(backupPath === undefined ? {} : { backupPath }),
            revision: await sha256File(target),
          };
        } finally {
          await rm(temporary, { force: true });
        }
      },
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
function uniqueBackupPath(target: string): string {
  return `${target}.bak-${new Date().toISOString().replace(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`;
}
