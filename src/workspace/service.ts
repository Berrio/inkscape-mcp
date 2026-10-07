import { createHash } from "node:crypto";
import { mkdir, open, opendir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import { WorkspacePathError } from "./errors.js";

export type Workspace = { id: string; root: string };
export type ResolvedWorkspacePath = {
  absolutePath: string;
  relativePath: string;
  /** Internal-only canonical root for downstream staging; never serialize it. */
  workspaceRoot: string;
  workspaceId: string;
};
export type DocumentPage = {
  documents: readonly string[];
  nextCursor?: string;
};

export class WorkspaceService {
  private constructor(private readonly workspaces: readonly Workspace[]) {}

  public static async create(
    roots: readonly string[],
  ): Promise<WorkspaceService> {
    const workspaces = await Promise.all(
      roots.map(async (root, index) => {
        const canonical = await realpath(root);
        const metadata = await stat(canonical);
        if (!metadata.isDirectory())
          throw new WorkspacePathError(
            "PATH_INVALID",
            "Workspace root is not a directory",
          );
        return { id: workspaceId(canonical, index), root: canonical };
      }),
    );
    return new WorkspaceService(
      workspaces.sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  public list(): readonly Workspace[] {
    return this.workspaces.map(({ id, root }) => ({ id, root }));
  }

  public async resolveExisting(
    workspaceId: string,
    clientPath: string,
  ): Promise<ResolvedWorkspacePath> {
    const workspace = this.workspace(workspaceId);
    assertSafeRelativePath(clientPath);
    const candidate = resolve(workspace.root, clientPath);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch {
      throw new WorkspacePathError("PATH_NOT_FOUND", "Document does not exist");
    }
    if (!isInside(workspace.root, canonical))
      throw new WorkspacePathError(
        "PATH_OUTSIDE_WORKSPACE",
        "Resolved path leaves the workspace",
      );
    if (!(await stat(canonical)).isFile())
      throw new WorkspacePathError("PATH_INVALID", "Document is not a file");
    return resolved(workspace, canonical);
  }

  public async resolveNewOutput(
    workspaceId: string,
    clientPath: string,
  ): Promise<ResolvedWorkspacePath> {
    const workspace = this.workspace(workspaceId);
    assertSafeRelativePath(clientPath);
    const candidate = resolve(workspace.root, clientPath);
    const canonicalParent = await realpath(dirname(candidate)).catch(() => {
      throw new WorkspacePathError(
        "PATH_NOT_FOUND",
        "Output parent does not exist",
      );
    });
    if (!isInside(workspace.root, canonicalParent))
      throw new WorkspacePathError(
        "PATH_OUTSIDE_WORKSPACE",
        "Output parent leaves the workspace",
      );
    return resolved(workspace, resolve(canonicalParent, basename(candidate)));
  }

  /** Creates a workspace-local output directory one checked segment at a time.
   * Existing reparse points are canonicalized before a later segment can be
   * created, preventing a preset from following an outside junction. */
  public async ensureOutputDirectory(
    workspaceId: string,
    clientPath: string,
  ): Promise<ResolvedWorkspacePath> {
    const workspace = this.workspace(workspaceId);
    assertSafeRelativePath(clientPath);
    let current = workspace.root;
    for (const segment of clientPath.split(/[\\/]+/u)) {
      const candidate = resolve(current, segment);
      try {
        const metadata = await stat(candidate);
        if (!metadata.isDirectory())
          throw new WorkspacePathError(
            "PATH_INVALID",
            "Output directory segment is not a directory",
          );
      } catch (error) {
        if (error instanceof WorkspacePathError) throw error;
        await mkdir(candidate);
      }
      const canonical = await realpath(candidate);
      if (!isInside(workspace.root, canonical))
        throw new WorkspacePathError(
          "PATH_OUTSIDE_WORKSPACE",
          "Output directory leaves the workspace",
        );
      current = canonical;
    }
    return resolved(workspace, current);
  }

  public async listDocuments(
    workspaceId: string,
    options: { cursor?: string; pageSize: number },
  ): Promise<DocumentPage> {
    const workspace = this.workspace(workspaceId);
    if (
      !Number.isInteger(options.pageSize) ||
      options.pageSize < 1 ||
      options.pageSize > 100
    )
      throw new WorkspacePathError(
        "PATH_INVALID",
        "pageSize must be between 1 and 100",
      );
    const after = decodeCursor(options.cursor, workspace.id);
    const documents = (await walkSvgDocuments(workspace.root)).sort();
    const start =
      after === undefined ? 0 : documents.findIndex((item) => item > after);
    const offset = start < 0 ? documents.length : start;
    const page = documents.slice(offset, offset + options.pageSize);
    const last = page.at(-1);
    return {
      documents: page,
      ...(last === undefined || page.length < options.pageSize
        ? {}
        : { nextCursor: encodeCursor(workspace.id, last) }),
    };
  }

  private workspace(id: string): Workspace {
    const workspace = this.workspaces.find((item) => item.id === id);
    if (!workspace)
      throw new WorkspacePathError("WORKSPACE_UNKNOWN", "Unknown workspace ID");
    return workspace;
  }
}

export function assertSafeRelativePath(value: string): void {
  if (
    !value ||
    value.includes("\0") ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[a-z]:/iu.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//")
  )
    throw new WorkspacePathError(
      "PATH_INVALID",
      "Path must be a safe relative path",
    );
  const segments = value.split(/[\\/]/u);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        // Win32 silently strips a trailing dot/space, so `out.svg.` would
        // name `out.svg` and defeat existence and extension checks.
        /[. ]$/u.test(segment) ||
        WINDOWS_RESERVED_NAME.test(segment),
    )
  )
    throw new WorkspacePathError(
      "PATH_INVALID",
      "Path contains a forbidden segment",
    );
}

/** DOS device names stay reserved with any extension (`NUL.svg`). */
const WINDOWS_RESERVED_NAME =
  /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\..*)?$/iu;

/**
 * Reads at most `maxBytes` from a resolved workspace file. The size is
 * checked on the open handle before any allocation, so an oversized document
 * is rejected without being loaded into memory.
 */
export async function readBoundedFile(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("maxBytes must be a positive integer");
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes)
      throw new WorkspacePathError(
        "PATH_INVALID",
        "Document exceeds the configured input size limit",
      );
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        size - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function readBoundedText(
  path: string,
  maxBytes: number,
): Promise<string> {
  return (await readBoundedFile(path, maxBytes)).toString("utf8");
}

export async function sniffSvgDocument(path: string): Promise<"svg" | "svgz"> {
  const extension = path.toLowerCase().split(".").at(-1);
  if (extension !== "svg" && extension !== "svgz")
    throw new WorkspacePathError(
      "PATH_INVALID",
      "Only .svg and .svgz documents are allowed",
    );
  const prefix = await readPrefix(path, 8192);
  if (extension === "svgz" && prefix[0] === 0x1f && prefix[1] === 0x8b)
    return "svgz";
  if (extension === "svg" && /<svg(?:\s|>)/iu.test(prefix.toString("utf8")))
    return "svg";
  throw new WorkspacePathError(
    "PATH_INVALID",
    "Document content does not match its SVG extension",
  );
}

async function readPrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function resolved(
  workspace: Workspace,
  absolutePath: string,
): ResolvedWorkspacePath {
  return {
    absolutePath,
    relativePath: relative(workspace.root, absolutePath).split(sep).join("/"),
    workspaceRoot: workspace.root,
    workspaceId: workspace.id,
  };
}

function workspaceId(root: string, index: number): string {
  return `ws_${createHash("sha256").update(`${index}\0${root}`).digest("hex").slice(0, 16)}`;
}

/** Bounds for one document listing; a larger tree needs a narrower root. */
export const MAX_LISTED_WORKSPACE_ENTRIES = 100_000;
export const MAX_LISTED_WORKSPACE_DEPTH = 32;

async function walkSvgDocuments(root: string): Promise<string[]> {
  const documents: string[] = [];
  const pending: { depth: number; path: string }[] = [{ depth: 0, path: root }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for await (const entry of await opendir(current.path)) {
      visited += 1;
      if (visited > MAX_LISTED_WORKSPACE_ENTRIES)
        throw new WorkspacePathError(
          "PATH_INVALID",
          "Workspace has too many entries to list; configure a narrower workspace root",
        );
      const path = resolve(current.path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth + 1 > MAX_LISTED_WORKSPACE_DEPTH)
          throw new WorkspacePathError(
            "PATH_INVALID",
            "Workspace is nested too deeply to list; configure a narrower workspace root",
          );
        pending.push({ depth: current.depth + 1, path });
      } else if (entry.isFile() && /\.svgz?$/iu.test(entry.name))
        documents.push(relative(root, path).split(sep).join("/"));
    }
  }
  return documents;
}

function encodeCursor(workspaceId: string, after: string): string {
  return Buffer.from(JSON.stringify({ after, workspaceId })).toString(
    "base64url",
  );
}
function decodeCursor(
  cursor: string | undefined,
  workspaceId: string,
): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "workspaceId" in value &&
      "after" in value &&
      value.workspaceId === workspaceId &&
      typeof value.after === "string"
    )
      return value.after;
  } catch {
    /* malformed below */
  }
  throw new WorkspacePathError("PATH_INVALID", "Invalid workspace cursor");
}
