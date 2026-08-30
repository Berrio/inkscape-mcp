import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  open,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

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
export type CommitBatchFileRequest = {
  contents: Uint8Array;
  expectedOutputRevision?: string;
  targetPath: string;
};
export type CommitBatchFileResult = {
  backupPath?: string;
  revision: string;
  targetPath: string;
};
export type CommitFileBatchRequest = {
  expectedRevision?: string;
  files: readonly CommitBatchFileRequest[];
  sourcePath?: string;
};
export type CommitFileBatchResult = {
  files: readonly CommitBatchFileResult[];
};
type TemporaryWriter = (path: string, contents: Uint8Array) => Promise<void>;
type TemporaryMover = (from: string, to: string) => Promise<void>;
export type AtomicFileStoreOptions = {
  /**
   * Workspace identities are captured at startup. Publication rechecks the
   * live target parent so a swapped junction cannot redirect a staged output.
   */
  workspaceRoots?: readonly string[];
};

export class AtomicFileStore {
  private readonly canonicalWorkspaceRoots: Promise<readonly string[]>;

  public constructor(
    private readonly locks = new CanonicalPathLocks(),
    private readonly writeTemporary: TemporaryWriter = writeDurableTemporary,
    options: AtomicFileStoreOptions = {},
    private readonly moveTemporary: TemporaryMover = rename,
  ) {
    this.canonicalWorkspaceRoots = Promise.all(
      (options.workspaceRoots ?? []).map(async (root) => realpath(root)),
    );
  }

  public async commit(request: CommitFileRequest): Promise<CommitFileResult> {
    const target = resolve(request.targetPath);
    return this.locks.withLocks(
      [target, ...(request.sourcePath ? [request.sourcePath] : [])],
      async () => {
        await this.assertPublishTargets([target]);
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
          await this.writeTemporary(temporary, request.contents);
          if (request.sourcePath && request.expectedRevision)
            await assertRevision(request.sourcePath, request.expectedRevision);
          await this.assertPublishTargets([target]);
          const finalExists = await fileExists(target);
          if (finalExists !== exists)
            throw new RevisionConflictError(
              "Output existence changed before publication",
            );
          if (finalExists && request.expectedOutputRevision)
            await assertRevision(target, request.expectedOutputRevision);
          if (exists) {
            backupPath = uniqueBackupPath(target);
            await copyFile(target, backupPath, 0);
          }
          await this.moveTemporary(temporary, target);
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

  /**
   * Publishes a small, related set of outputs with one lock/revision boundary.
   * A process crash between renames cannot be made filesystem-atomic across files,
   * but handled failures restore every already-published member from its backup.
   */
  public async commitBatch(
    request: CommitFileBatchRequest,
  ): Promise<CommitFileBatchResult> {
    if (request.files.length < 1 || request.files.length > 100)
      throw new Error("A commit batch must contain between 1 and 100 files");
    const files = request.files.map((file) => ({
      ...file,
      targetPath: resolve(file.targetPath),
    }));
    if (
      new Set(files.map((file) => file.targetPath.toLocaleLowerCase())).size !==
      files.length
    )
      throw new Error("A commit batch cannot contain duplicate output paths");
    return this.locks.withLocks(
      [
        ...files.map((file) => file.targetPath),
        ...(request.sourcePath ? [request.sourcePath] : []),
      ],
      async () => {
        await this.assertPublishTargets(files.map((file) => file.targetPath));
        if (request.sourcePath && request.expectedRevision)
          await assertRevision(request.sourcePath, request.expectedRevision);
        const staged = await Promise.all(
          files.map(async (file) => ({
            ...file,
            exists: await fileExists(file.targetPath),
          })),
        );
        for (const file of staged) {
          if (file.exists && file.expectedOutputRevision === undefined)
            throw new RevisionConflictError(
              "Overwriting an output requires expectedOutputRevision",
            );
          if (file.exists && file.expectedOutputRevision)
            await assertRevision(file.targetPath, file.expectedOutputRevision);
        }
        const temporaries = staged.map((file) =>
          join(
            dirname(file.targetPath),
            `.${basename(file.targetPath)}.inkscape-mcp-${crypto.randomUUID()}.tmp`,
          ),
        );
        const backups: (string | undefined)[] = staged.map(() => undefined);
        const published: number[] = [];
        try {
          for (let index = 0; index < staged.length; index += 1)
            await this.writeTemporary(
              temporaries[index]!,
              staged[index]!.contents,
            );
          if (request.sourcePath && request.expectedRevision)
            await assertRevision(request.sourcePath, request.expectedRevision);
          await this.assertPublishTargets(
            staged.map((file) => file.targetPath),
          );
          for (const file of staged) {
            const finalExists = await fileExists(file.targetPath);
            if (finalExists !== file.exists)
              throw new RevisionConflictError(
                "Output existence changed before publication",
              );
            if (finalExists && file.expectedOutputRevision)
              await assertRevision(
                file.targetPath,
                file.expectedOutputRevision,
              );
          }
          for (let index = 0; index < staged.length; index += 1) {
            const file = staged[index]!;
            if (!file.exists) continue;
            const backup = uniqueBackupPath(file.targetPath);
            await copyFile(file.targetPath, backup, 0);
            backups[index] = backup;
          }
          for (let index = 0; index < staged.length; index += 1) {
            await this.moveTemporary(
              temporaries[index]!,
              staged[index]!.targetPath,
            );
            published.push(index);
          }
          return {
            files: await Promise.all(
              staged.map(async (file, index) => ({
                ...(backups[index] === undefined
                  ? {}
                  : { backupPath: backups[index] }),
                revision: await sha256File(file.targetPath),
                targetPath: file.targetPath,
              })),
            ),
          };
        } catch (error) {
          await Promise.all(
            published.map(async (index) => {
              const file = staged[index]!;
              const backup = backups[index];
              if (backup === undefined)
                await rm(file.targetPath, { force: true });
              else await copyFile(backup, file.targetPath, 0);
            }),
          );
          throw error;
        } finally {
          await Promise.all(
            temporaries.map((path) => rm(path, { force: true })),
          );
        }
      },
    );
  }

  private async assertPublishTargets(paths: readonly string[]): Promise<void> {
    const roots = await this.canonicalWorkspaceRoots;
    if (roots.length === 0) return;
    for (const target of paths) {
      const parent = await realpath(dirname(target)).catch(() => {
        throw new RevisionConflictError(
          "Output parent is no longer available for publication",
        );
      });
      if (!roots.some((root) => isInsideWorkspaceRoot(root, parent)))
        throw new RevisionConflictError(
          "Output parent no longer belongs to an authorized workspace",
        );
      const metadata = await lstat(target).catch(() => undefined);
      if (metadata?.isSymbolicLink())
        throw new RevisionConflictError(
          "Refusing to publish through a symbolic-link output",
        );
    }
  }
}

async function writeDurableTemporary(
  path: string,
  contents: Uint8Array,
): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
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

function isInsideWorkspaceRoot(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}
