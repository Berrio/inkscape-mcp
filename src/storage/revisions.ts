import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  utimes,
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

/**
 * Fails with a stable, client-visible code (ADR-006). `output` marks a
 * mismatch of an existing export target, so a client can tell it apart from a
 * stale source document.
 */
export async function assertRevision(
  path: string,
  expectedRevision: string,
  conflict: "document" | "output" = "document",
): Promise<void> {
  const actual = await sha256File(path);
  if (actual !== expectedRevision) {
    throw new RevisionConflictError(
      conflict === "output"
        ? "OUTPUT_REVISION_CONFLICT: Output revision no longer matches"
        : "REVISION_CONFLICT: Document revision no longer matches",
    );
  }
}

export type CanonicalPathLockOptions = {
  /**
   * Server-owned directory for advisory lock files shared by every local
   * inkscape-mcp process (stdio, HTTP, CLI recipes and queue workers). When
   * omitted, locks only serialize callers inside this process.
   */
  lockDirectory?: string | undefined;
  /**
   * The holder refreshes its lock file's mtime at this interval for as long
   * as it holds the lock, however long the operation takes.
   */
  heartbeatMs?: number | undefined;
  /**
   * A lock whose heartbeat is older than this is abandoned even if its PID
   * looks alive (the PID may have been reused after a crash). Must exceed
   * several heartbeats so a busy holder is never mistaken for a dead one.
   */
  staleAfterMs?: number | undefined;
  /** Maximum wait for a lock held by another process. */
  timeoutMs?: number | undefined;
};

export class CanonicalPathLocks {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly lockDirectory: string | undefined;
  private readonly heartbeatMs: number;
  private readonly staleAfterMs: number;
  private readonly timeoutMs: number;

  public constructor(options: CanonicalPathLockOptions = {}) {
    this.lockDirectory =
      options.lockDirectory === undefined
        ? undefined
        : resolve(options.lockDirectory);
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.staleAfterMs = options.staleAfterMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (this.staleAfterMs < this.heartbeatMs * 3)
      throw new Error("staleAfterMs must cover at least three heartbeats");
  }

  public async acquire(paths: readonly string[]): Promise<() => Promise<void>> {
    const keys = [
      ...new Set(paths.map((path) => resolve(path).toLocaleLowerCase())),
    ].sort();
    const releases: (() => Promise<void> | void)[] = [];
    try {
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
        if (this.lockDirectory !== undefined)
          releases.push(await this.acquireFileLock(key));
      }
    } catch (error) {
      for (const release of releases.reverse()) await release();
      throw error;
    }
    return async () => {
      for (const release of releases.reverse()) await release();
    };
  }

  /** Cross-process exclusion through an O_EXCL file; a lock left by a
   * crashed process is reclaimed when its PID is gone or it is stale. */
  private async acquireFileLock(key: string): Promise<() => Promise<void>> {
    const directory = this.lockDirectory!;
    await mkdir(directory, { recursive: true });
    const path = join(
      directory,
      `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.lock`,
    );
    const token = crypto.randomUUID();
    const deadline = Date.now() + this.timeoutMs;
    let delayMs = 10;
    for (;;) {
      try {
        const handle = await open(path, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({ createdAt: Date.now(), pid: process.pid, token }),
          );
        } finally {
          await handle.close();
        }
        // Keep the lock visibly alive during long operations (batches can
        // run for many minutes), so it is never reclaimed while held.
        const heartbeat = setInterval(() => {
          const now = new Date();
          void utimes(path, now, now).catch(() => undefined);
        }, this.heartbeatMs);
        heartbeat.unref();
        return async () => {
          clearInterval(heartbeat);
          const owner = await readLockOwner(path);
          if (typeof owner === "object" && owner.token === token)
            await rm(path, { force: true });
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // On Windows a lock file that was just removed while another
        // process still had it open stays "delete pending", and creating it
        // again fails with EPERM/EACCES instead of EEXIST: treat it as busy.
        if (code === "EPERM" || code === "EACCES") {
          if (Date.now() >= deadline) throw error;
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, delayMs),
          );
          delayMs = Math.min(delayMs * 2, 250);
          continue;
        }
        if (code !== "EEXIST") throw error;
      }
      const owner = await readLockOwner(path);
      if (owner === "missing") continue;
      if (await this.isAbandoned(path, owner)) {
        await reclaimAbandonedLock(path, owner);
        continue;
      }
      if (Date.now() >= deadline)
        throw new RevisionConflictError(
          "Document is locked by another inkscape-mcp process",
        );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      delayMs = Math.min(delayMs * 2, 250);
    }
  }

  /** A lock is abandoned when its holder is gone or stopped heartbeating. */
  private async isAbandoned(
    path: string,
    owner: LockOwner | "unreadable",
  ): Promise<boolean> {
    if (owner !== "unreadable" && !isProcessAlive(owner.pid)) return true;
    return isOlderThan(path, this.staleAfterMs);
  }

  public async withLocks<T>(
    paths: readonly string[],
    action: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(paths);
    try {
      return await action();
    } finally {
      await release();
    }
  }
}

type LockOwner = { createdAt: number; pid: number; token: string };

async function readLockOwner(
  path: string,
): Promise<LockOwner | "missing" | "unreadable"> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "unreadable";
  }
  try {
    const value: unknown = JSON.parse(contents);
    if (
      typeof value === "object" &&
      value !== null &&
      "createdAt" in value &&
      "pid" in value &&
      "token" in value &&
      Number.isSafeInteger(value.createdAt) &&
      Number.isSafeInteger(value.pid) &&
      typeof value.token === "string"
    )
      return value as LockOwner;
  } catch {
    /* a lock is unreadable while its creator is still writing it */
  }
  return "unreadable";
}

/** A reclaim guard older than this belongs to a crashed reclaimer. */
const RECLAIM_GUARD_STALE_MS = 5_000;

/**
 * Removes an abandoned lock without ever deleting a fresh one. Reclaimers
 * serialize on an exclusive `<lock>.reclaim` guard and re-read the owner
 * inside it. While the abandoned file exists nobody can create a new lock
 * (`wx` fails), so the only writer that could replace it is another
 * reclaimer, which the guard excludes: a token match inside the guard proves
 * the file is still the abandoned one.
 */
async function reclaimAbandonedLock(
  path: string,
  judged: LockOwner | "unreadable",
): Promise<void> {
  const guard = `${path}.reclaim`;
  try {
    await (await open(guard, "wx")).close();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Delete-pending guard (Windows): another reclaimer just finished.
    if (code === "EPERM" || code === "EACCES") return;
    if (code !== "EEXIST") throw error;
    if (await isOlderThan(guard, RECLAIM_GUARD_STALE_MS))
      await rm(guard, { force: true });
    return;
  }
  try {
    if (sameLockOwner(judged, await readLockOwner(path)))
      await rm(path, { force: true });
  } finally {
    await rm(guard, { force: true });
  }
}

function sameLockOwner(
  judged: LockOwner | "unreadable",
  current: LockOwner | "missing" | "unreadable",
): boolean {
  if (typeof judged === "object")
    return typeof current === "object" && current.token === judged.token;
  return current === "unreadable";
}

async function isOlderThan(path: string, ageMs: number): Promise<boolean> {
  const metadata = await stat(path).catch(() => undefined);
  return metadata === undefined || Date.now() - metadata.mtimeMs > ageMs;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
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
  /**
   * Number of timestamped in-place backups kept per target. Older backups
   * created by this store (`<name>.bak-<ISO>-<id>`) are pruned after a
   * successful publication; unrelated files are never touched.
   */
  backupRetention?: number;
};

const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
export const RENAME_RETRY_ATTEMPTS = 8;

/**
 * Windows refuses to replace a file while another process (for example a
 * concurrent revision check) holds it open, reporting EPERM/EBUSY/EACCES.
 * Measured: 1979 of 4591 cross-process replacements failed that way while a
 * reader looped on the target. Such handles are short-lived, so the
 * replacement is retried with bounded backoff (~2.5 s total); a persistent
 * error is rethrown unchanged.
 */
export async function renameWithTransientRetry(
  from: string,
  to: string,
  move: TemporaryMover = rename,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await move(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= RENAME_RETRY_ATTEMPTS ||
        code === undefined ||
        !TRANSIENT_RENAME_CODES.has(code)
      )
        throw error;
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 10 * 2 ** attempt),
      );
    }
  }
}

/** Default number of in-place backups retained per document. */
export const DEFAULT_BACKUP_RETENTION = 10;

export class AtomicFileStore {
  private readonly canonicalWorkspaceRoots: Promise<readonly string[]>;
  private readonly backupRetention: number;

  public constructor(
    private readonly locks = new CanonicalPathLocks(),
    private readonly writeTemporary: TemporaryWriter = writeDurableTemporary,
    options: AtomicFileStoreOptions = {},
    private readonly moveTemporary: TemporaryMover = renameWithTransientRetry,
  ) {
    this.backupRetention = options.backupRetention ?? DEFAULT_BACKUP_RETENTION;
    if (!Number.isSafeInteger(this.backupRetention) || this.backupRetention < 1)
      throw new Error("backupRetention must be a positive integer");
    this.canonicalWorkspaceRoots = Promise.all(
      (options.workspaceRoots ?? []).map(async (root) => realpath(root)),
    );
  }

  public async commit(request: CommitFileRequest): Promise<CommitFileResult> {
    assertRevisionFormat(request.expectedRevision);
    assertRevisionFormat(request.expectedOutputRevision);
    const target = resolve(request.targetPath);
    return this.locks.withLocks(
      [target, ...(request.sourcePath ? [request.sourcePath] : [])],
      async () => {
        await this.assertPublishTargets([target]);
        if (request.sourcePath && request.expectedRevision !== undefined)
          await assertRevision(request.sourcePath, request.expectedRevision);
        const exists = await fileExists(target);
        if (exists && request.expectedOutputRevision === undefined)
          throw new RevisionConflictError(
            "Overwriting an output requires expectedOutputRevision",
          );
        if (exists && request.expectedOutputRevision !== undefined)
          await assertRevision(
            target,
            request.expectedOutputRevision,
            "output",
          );
        const temporary = join(
          dirname(target),
          `.${basename(target)}.inkscape-mcp-${crypto.randomUUID()}.tmp`,
        );
        let backupPath: string | undefined;
        try {
          await this.writeTemporary(temporary, request.contents);
          if (request.sourcePath && request.expectedRevision !== undefined)
            await assertRevision(request.sourcePath, request.expectedRevision);
          await this.assertPublishTargets([target]);
          const finalExists = await fileExists(target);
          if (finalExists !== exists)
            throw new RevisionConflictError(
              "Output existence changed before publication",
            );
          if (finalExists && request.expectedOutputRevision !== undefined)
            await assertRevision(
              target,
              request.expectedOutputRevision,
              "output",
            );
          if (exists) {
            backupPath = uniqueBackupPath(target);
            await copyFile(target, backupPath, 0);
          }
          await this.moveTemporary(temporary, target);
          if (backupPath !== undefined)
            await pruneBackups(target, this.backupRetention);
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
    assertRevisionFormat(request.expectedRevision);
    for (const file of request.files)
      assertRevisionFormat(file.expectedOutputRevision);
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
        if (request.sourcePath && request.expectedRevision !== undefined)
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
          if (file.exists && file.expectedOutputRevision !== undefined)
            await assertRevision(
              file.targetPath,
              file.expectedOutputRevision,
              "output",
            );
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
          if (request.sourcePath && request.expectedRevision !== undefined)
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
            if (finalExists && file.expectedOutputRevision !== undefined)
              await assertRevision(
                file.targetPath,
                file.expectedOutputRevision,
                "output",
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
          for (let index = 0; index < staged.length; index += 1)
            if (backups[index] !== undefined)
              await pruneBackups(
                staged[index]!.targetPath,
                this.backupRetention,
              );
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

function assertRevisionFormat(revision: string | undefined): void {
  if (revision !== undefined && !/^[a-f0-9]{64}$/u.test(revision))
    throw new RevisionConflictError("Revision must be a SHA-256 hex digest");
}

/**
 * Keeps the newest `retain` backups this store created for `target`. Pruning
 * is best effort after a successful publication: it never fails or rolls back
 * the commit, and it only matches the store's own timestamped names.
 */
async function pruneBackups(target: string, retain: number): Promise<void> {
  const prefix = `${basename(target)}.bak-`;
  const backupSuffix =
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/u;
  const directory = dirname(target);
  try {
    const backups = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(prefix) &&
          backupSuffix.test(entry.name.slice(prefix.length)),
      )
      .map((entry) => entry.name)
      .sort();
    await Promise.all(
      backups
        .slice(0, Math.max(0, backups.length - retain))
        .map((name) => rm(join(directory, name), { force: true })),
    );
  } catch {
    /* retention is housekeeping; the committed document is already durable */
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
