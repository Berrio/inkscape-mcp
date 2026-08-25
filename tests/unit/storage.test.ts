import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AtomicFileStore,
  CanonicalPathLocks,
  RevisionConflictError,
  ScratchManager,
  sha256File,
} from "../../src/storage/index.js";

const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inkscape-mcp-storage-"));
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

describe("file revisions and atomic store", () => {
  it("streams a revision and refuses stale source or output revisions", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const target = join(root, "target.svg");
    await writeFile(source, "old");
    await writeFile(target, "existing");
    const store = new AtomicFileStore();
    await expect(
      store.commit({
        contents: Buffer.from("next"),
        expectedRevision: "stale",
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      store.commit({
        contents: Buffer.from("next"),
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    const result = await store.commit({
      contents: Buffer.from("next"),
      expectedOutputRevision: await sha256File(target),
      expectedRevision: await sha256File(source),
      sourcePath: source,
      targetPath: target,
    });
    expect(await readFile(target, "utf8")).toBe("next");
    expect(result.backupPath).toBeDefined();
  });
  it("serializes conflicting writers in a deterministic lock order", async () => {
    const locks = new CanonicalPathLocks();
    const events: string[] = [];
    await Promise.all([
      locks.withLocks(["b", "a"], async () => {
        events.push("first");
      }),
      locks.withLocks(["a", "b"], async () => {
        events.push("second");
      }),
    ]);
    expect(events).toEqual(["first", "second"]);
  });
  it("cleans only its own stale scratch directories", async () => {
    const root = await temporaryDirectory();
    const scratch = new ScratchManager(root);
    const stale = await scratch.create("job");
    const retained = join(root, "unrelated");
    await writeFile(join(stale, "file"), "x");
    await writeFile(retained, "keep");
    await utimes(stale, new Date(0), new Date(0));
    await expect(scratch.cleanupStale(1)).resolves.toBe(1);
    await expect(readFile(retained, "utf8")).resolves.toBe("keep");
    const path = await scratch.withDirectory(
      "probe",
      async (directory) => directory,
    );
    await expect(readFile(path)).rejects.toBeDefined();
  });
});
