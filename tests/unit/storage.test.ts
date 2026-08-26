import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AtomicFileStore,
  ArtifactStore,
  CanonicalPathLocks,
  createNativeInputBundle,
  RevisionConflictError,
  ScratchManager,
  SnapshotStore,
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
  it("freezes a matching source before native processing", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const staging = join(root, "staging");
    await writeFile(source, "<svg />");
    await mkdir(staging);
    const expectedRevision = await sha256File(source);
    const bundle = await createNativeInputBundle(
      source,
      expectedRevision,
      staging,
    );
    expect(bundle.revision).toBe(expectedRevision);
    expect(await readFile(bundle.path, "utf8")).toBe("<svg />");
    await writeFile(source, "changed");
    await expect(
      createNativeInputBundle(source, expectedRevision, staging),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it("rejects unsafe SVG before a native process can receive it", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "unsafe.svg");
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(source, "<svg><script/></svg>");
    await expect(
      createNativeInputBundle(source, await sha256File(source), staging),
    ).rejects.toThrow("Native export input violates the SVG safety policy");
  });
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
  it("keeps the destination intact when temporary storage reports no space", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const target = join(root, "target.svg");
    await writeFile(source, "source");
    await writeFile(target, "existing");
    const store = new AtomicFileStore(
      new CanonicalPathLocks(),
      async (temporaryPath) => {
        await writeFile(temporaryPath, "partial");
        const error = new Error("No space left on device") as Error & {
          code: string;
        };
        error.code = "ENOSPC";
        throw error;
      },
    );
    await expect(
      store.commit({
        contents: Buffer.from("replacement"),
        expectedOutputRevision: await sha256File(target),
        expectedRevision: await sha256File(source),
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    await expect(readFile(target, "utf8")).resolves.toBe("existing");
    expect(
      (await readdir(root)).filter((name) => name.includes("inkscape-mcp")),
    ).toEqual([]);
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
    let failedPath = "";
    await expect(
      scratch.withDirectory("job", async (directory) => {
        failedPath = directory;
        throw new Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    await expect(readFile(failedPath)).rejects.toBeDefined();
  });
  it("restores an opaque owner-bound snapshot only against the expected revision", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const target = join(root, "target.svg");
    await writeFile(source, "before");
    await writeFile(target, "after");
    const snapshots = new SnapshotStore(join(root, "snapshots"));
    const sourceRevision = await sha256File(source);
    const snapshot = await snapshots.create(
      source,
      "owner-a",
      60_000,
      sourceRevision,
    );
    const reopened = new SnapshotStore(join(root, "snapshots"));
    await expect(
      reopened.restore(
        snapshot.id,
        "owner-b",
        target,
        await sha256File(target),
      ),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      reopened.restore(snapshot.id, "owner-a", target, "stale"),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      reopened.restore(
        snapshot.id,
        "owner-a",
        target,
        await sha256File(target),
      ),
    ).resolves.toEqual({ backupCreated: true, revision: snapshot.revision });
    expect(await readFile(target, "utf8")).toBe("before");
  });
  it("rejects a source that changed during snapshot creation and retains a bounded history", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    await writeFile(source, "first");
    const snapshots = new SnapshotStore(join(root, "snapshots"), undefined, 1);
    const firstRevision = await sha256File(source);
    const first = await snapshots.create(
      source,
      "owner-a",
      60_000,
      firstRevision,
    );
    await writeFile(source, "second");
    const secondRevision = await sha256File(source);
    const reopened = new SnapshotStore(join(root, "snapshots"), undefined, 1);
    const second = await reopened.create(
      source,
      "owner-a",
      60_000,
      secondRevision,
    );
    await expect(
      reopened.restore(first.id, "owner-a", source, secondRevision),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      reopened.restore(second.id, "owner-a", source, firstRevision),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      reopened.create(source, "owner-a", 60_000, firstRevision),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it("serves bounded artifact chunks to only their owner", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "export.png");
    await writeFile(source, "abcdefghij");
    const artifacts = new ArtifactStore(join(root, "artifacts"), 100);
    const artifact = await artifacts.publish(source, "owner-a", 60_000);
    expect(artifact.uri).toBe(`inkscape://artifact/${artifact.id}`);
    await expect(
      artifacts.readChunk(artifact.id, "owner-b", 0, 3, 4),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      artifacts.readChunk(artifact.id, "owner-a", 2, 3, 4),
    ).resolves.toMatchObject({ bytes: Buffer.from("cde"), size: 10 });
    await expect(
      artifacts.readChunk(artifact.id, "owner-a", 0, 5, 4),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
});
