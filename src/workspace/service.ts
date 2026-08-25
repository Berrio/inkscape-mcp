import { createHash } from "node:crypto";
import { opendir, readFile, realpath, stat } from "node:fs/promises";
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
  const segments = value.split(/[\\/]+/u);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":"),
    )
  )
    throw new WorkspacePathError(
      "PATH_INVALID",
      "Path contains a forbidden segment",
    );
}

export async function sniffSvgDocument(path: string): Promise<"svg" | "svgz"> {
  const extension = path.toLowerCase().split(".").at(-1);
  if (extension !== "svg" && extension !== "svgz")
    throw new WorkspacePathError(
      "PATH_INVALID",
      "Only .svg and .svgz documents are allowed",
    );
  const prefix = (await readFile(path)).subarray(0, 8192);
  if (extension === "svgz" && prefix[0] === 0x1f && prefix[1] === 0x8b)
    return "svgz";
  if (extension === "svg" && /<svg(?:\s|>)/iu.test(prefix.toString("utf8")))
    return "svg";
  throw new WorkspacePathError(
    "PATH_INVALID",
    "Document content does not match its SVG extension",
  );
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
    workspaceId: workspace.id,
  };
}

function workspaceId(root: string, index: number): string {
  return `ws_${createHash("sha256").update(`${index}\0${root}`).digest("hex").slice(0, 16)}`;
}

async function walkSvgDocuments(
  root: string,
  current = root,
): Promise<string[]> {
  const directory = await opendir(current);
  const documents: string[] = [];
  for await (const entry of directory) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory())
      documents.push(...(await walkSvgDocuments(root, path)));
    else if (entry.isFile() && /\.svgz?$/iu.test(entry.name))
      documents.push(relative(root, path).split(sep).join("/"));
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
