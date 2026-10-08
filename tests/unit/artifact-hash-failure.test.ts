import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as RevisionsModule from "../../src/storage/revisions.js";

const hashFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock("../../src/storage/revisions.js", async (importOriginal) => {
  const original = await importOriginal<typeof RevisionsModule>();
  return {
    ...original,
    sha256File: async (path: string) => {
      if (hashFailure.enabled) throw new Error("simulated read failure");
      return original.sha256File(path);
    },
  };
});

const { ArtifactStore } = await import("../../src/storage/artifacts.js");

const directories: string[] = [];
afterEach(async () => {
  hashFailure.enabled = false;
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("artifact publication failures", () => {
  it("removes the copied file when hashing fails, leaving no orphan", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-art-hash-"));
    directories.push(root);
    const source = join(root, "out.png");
    await writeFile(source, "png bytes");
    const artifactsRoot = join(root, "artifacts");
    const store = new ArtifactStore(artifactsRoot, 1_024);
    hashFailure.enabled = true;
    await expect(store.publish(source, "owner", 60_000)).rejects.toThrow(
      "simulated read failure",
    );
    await expect(readdir(artifactsRoot)).resolves.toEqual([]);
    hashFailure.enabled = false;
    await expect(store.publish(source, "owner", 60_000)).resolves.toMatchObject(
      { size: 9 },
    );
  });
});
