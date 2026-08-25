import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeRelativePath,
  WorkspacePathError,
  WorkspaceService,
  sniffSvgDocument,
} from "../../src/workspace/index.js";

const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const path = join(
    tmpdir(),
    `inkscape-mcp-workspace-${Date.now()}-${temporaryDirectories.length}`,
  );
  await mkdir(path);
  temporaryDirectories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("workspace boundary", () => {
  it("rejects client path escape syntax before filesystem access", () => {
    for (const value of [
      "",
      "../x.svg",
      "C:\\x.svg",
      "\\\\server\\share\\x.svg",
      "dir/file:stream.svg",
      "a/./b.svg",
      "a\0b.svg",
    ])
      expect(() => assertSafeRelativePath(value)).toThrow(WorkspacePathError);
  });
  it("resolves existing input and new output only inside a canonical root", async () => {
    const root = await temporaryDirectory();
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(nested, "design.svg"), "<svg/>");
    const service = await WorkspaceService.create([root]);
    const workspace = service.list()[0]!;
    await expect(
      service.resolveExisting(workspace.id, "nested/design.svg"),
    ).resolves.toMatchObject({ relativePath: "nested/design.svg" });
    await expect(
      service.resolveNewOutput(workspace.id, "nested/export.png"),
    ).resolves.toMatchObject({ relativePath: "nested/export.png" });
  });
  it("rejects a symlink that resolves outside the workspace", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, "secret.svg"), "<svg/>");
    await symlink(outside, join(root, "linked-directory"), "junction");
    const service = await WorkspaceService.create([root]);
    await expect(
      service.resolveExisting(
        service.list()[0]!.id,
        "linked-directory/secret.svg",
      ),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });
  it("sniffs SVG and paginates only allowed document names", async () => {
    const root = await temporaryDirectory();
    await writeFile(
      join(root, "a.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    await writeFile(join(root, "b.svg"), "<svg/>");
    await writeFile(join(root, "not-svg.png"), "<svg/>");
    const service = await WorkspaceService.create([root]);
    const workspace = service.list()[0]!;
    await expect(sniffSvgDocument(join(root, "a.svg"))).resolves.toBe("svg");
    await expect(
      sniffSvgDocument(join(root, "not-svg.png")),
    ).rejects.toMatchObject({ code: "PATH_INVALID" });
    const first = await service.listDocuments(workspace.id, { pageSize: 1 });
    expect(first.documents).toEqual(["a.svg"]);
    await expect(
      service.listDocuments(workspace.id, {
        cursor: first.nextCursor,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ documents: ["b.svg"] });
  });
});
