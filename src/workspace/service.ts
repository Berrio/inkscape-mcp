import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
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
