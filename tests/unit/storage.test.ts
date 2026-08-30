import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
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
  it("stages every local SVG dependency with rewritten URIs and a reproducible manifest", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const assets = join(root, "assets");
    const staging = join(root, "staging");
    await mkdir(assets);
    await mkdir(staging);
    await writeFile(join(assets, "texture.png"), "texture");
    await writeFile(
      source,
      '<svg><image href="assets/texture.png"/><style>.x { fill: url("assets/texture.png#paint") }</style></svg>',
    );
    const bundle = await createNativeInputBundle(
      source,
      await sha256File(source),
      staging,
      { allowedRoot: root },
    );
    expect(bundle.manifest).toEqual({
      dependencies: [
        expect.objectContaining({
          path: "assets/0000-texture.png",
          uri: "assets/texture.png",
        }),
      ],
      source: { path: "input.svg", revision: await sha256File(source) },
    });
    await expect(
      readFile(join(staging, "assets", "0000-texture.png"), "utf8"),
    ).resolves.toBe("texture");
    await expect(readFile(bundle.path, "utf8")).resolves.toContain(
      "assets/0000-texture.png",
    );
    await expect(readFile(bundle.manifestPath, "utf8")).resolves.not.toContain(
      root,
    );
  });
  it("keeps an approved embedded raster inside the native SVG without staging it", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(
      source,
      '<svg><image href="data:image/png;base64,AA=="/><image href="data:image/bmp;base64,AA=="/></svg>',
    );
    const bundle = await createNativeInputBundle(
      source,
      await sha256File(source),
      staging,
      { allowedRoot: root },
    );
    expect(bundle.manifest.dependencies).toEqual([]);
    await expect(readFile(bundle.path, "utf8")).resolves.toContain(
      "data:image/png;base64,AA==",
    );
    await expect(readFile(bundle.path, "utf8")).resolves.toContain(
      "data:image/bmp;base64,AA==",
    );
  });
  it("rejects dependencies outside the workspace and detects a concurrent dependency writer", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "workspace");
    const staging = join(root, "staging");
    const source = join(root, "source.svg");
    const outside = join(parent, "outside.png");
    await mkdir(root);
    await mkdir(staging);
    await writeFile(outside, "outside");
    await writeFile(source, '<svg><image href="../outside.png"/></svg>');
    await expect(
      createNativeInputBundle(source, await sha256File(source), staging, {
        allowedRoot: root,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    const asset = join(root, "asset.png");
    await writeFile(asset, "first");
    await writeFile(source, '<svg><image href="asset.png"/></svg>');
    await expect(
      createNativeInputBundle(source, await sha256File(source), staging, {
        allowedRoot: root,
        beforeFinalVerification: async () => {
          await writeFile(asset, "second");
        },
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it("rehashes a staged bundle before publication", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const asset = join(root, "asset.png");
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(asset, "first");
    await writeFile(source, '<svg><image href="asset.png"/></svg>');
    const bundle = await createNativeInputBundle(
      source,
      await sha256File(source),
      staging,
      { allowedRoot: root },
    );
    await writeFile(asset, "second");
    await expect(bundle.assertCurrent()).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
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
  it("enforces a strict configured ceiling for native inputs", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "foreign.svg");
    const staging = join(root, "staging");
    await mkdir(staging);
    await writeFile(source, "<svg><foreignObject/></svg>");
    await expect(
      createNativeInputBundle(source, await sha256File(source), staging, {
        maximumSanitizeMode: "strict",
      }),
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
  it("commits related outputs as one handled rollback boundary", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const pdf = join(root, "output.pdf");
    const latex = join(root, "output.pdf_tex");
    await writeFile(source, "source");
    const store = new AtomicFileStore();
    const result = await store.commitBatch({
      expectedRevision: await sha256File(source),
      files: [
        { contents: Buffer.from("pdf"), targetPath: pdf },
        { contents: Buffer.from("latex"), targetPath: latex },
      ],
      sourcePath: source,
    });
    expect(result.files.map((file) => file.revision)).toEqual([
      await sha256File(pdf),
      await sha256File(latex),
    ]);
    await expect(readFile(pdf, "utf8")).resolves.toBe("pdf");
    await expect(readFile(latex, "utf8")).resolves.toBe("latex");
  });
  it("does not publish a primary output when a batch member cannot be staged", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const pdf = join(root, "output.pdf");
    const latex = join(root, "output.pdf_tex");
    await writeFile(source, "source");
    let writes = 0;
    const store = new AtomicFileStore(
      new CanonicalPathLocks(),
      async (temporaryPath, contents) => {
        writes += 1;
        if (writes === 2) throw new Error("sidecar staging failed");
        await writeFile(temporaryPath, contents);
      },
    );
    await expect(
      store.commitBatch({
        expectedRevision: await sha256File(source),
        files: [
          { contents: Buffer.from("pdf"), targetPath: pdf },
          { contents: Buffer.from("latex"), targetPath: latex },
        ],
        sourcePath: source,
      }),
    ).rejects.toThrow("sidecar staging failed");
    await expect(readFile(pdf)).rejects.toBeDefined();
    await expect(readFile(latex)).rejects.toBeDefined();
    expect(
      (await readdir(root)).filter((name) => name.includes("inkscape-mcp")),
    ).toEqual([]);
  });
  it("rejects a batch before publication when an existing sidecar lacks its revision", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const pdf = join(root, "output.pdf");
    const latex = join(root, "output.pdf_tex");
    await writeFile(source, "source");
    await writeFile(latex, "existing sidecar");
    const store = new AtomicFileStore();
    await expect(
      store.commitBatch({
        expectedRevision: await sha256File(source),
        files: [
          { contents: Buffer.from("pdf"), targetPath: pdf },
          { contents: Buffer.from("latex"), targetPath: latex },
        ],
        sourcePath: source,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(readFile(pdf)).rejects.toBeDefined();
    await expect(readFile(latex, "utf8")).resolves.toBe("existing sidecar");
  });
  it("rejects an external source or destination writer before atomic publication", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const target = join(root, "target.svg");
    await writeFile(source, "source");
    await writeFile(target, "existing");
    const sourceRevision = await sha256File(source);
    const targetRevision = await sha256File(target);
    const store = new AtomicFileStore(
      new CanonicalPathLocks(),
      async (temporaryPath, contents) => {
        await writeFile(temporaryPath, contents);
        await writeFile(target, "external destination writer");
      },
    );
    await expect(
      store.commit({
        contents: Buffer.from("replacement"),
        expectedOutputRevision: targetRevision,
        expectedRevision: sourceRevision,
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(readFile(target, "utf8")).resolves.toBe(
      "external destination writer",
    );
  });
  it("rechecks the source after a concurrent writer creates the temporary output", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.svg");
    const target = join(root, "target.svg");
    await writeFile(source, "source");
    const sourceRevision = await sha256File(source);
    const store = new AtomicFileStore(
      new CanonicalPathLocks(),
      async (temporaryPath, contents) => {
        await writeFile(temporaryPath, contents);
        await writeFile(source, "external source writer");
      },
    );
    await expect(
      store.commit({
        contents: Buffer.from("replacement"),
        expectedRevision: sourceRevision,
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(readFile(target)).rejects.toBeDefined();
  });
  it("rejects a junction swapped during staging before it can publish outside the workspace", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const destination = join(root, "destination");
    const source = join(root, "source.svg");
    const target = join(destination, "result.png");
    await mkdir(destination);
    await writeFile(source, "source");
    const store = new AtomicFileStore(
      new CanonicalPathLocks(),
      async (temporaryPath, contents) => {
        await writeFile(temporaryPath, contents);
        await rm(destination, { force: true, recursive: true });
        await symlink(outside, destination, "junction");
      },
      { workspaceRoots: [root] },
    );
    await expect(
      store.commit({
        contents: Buffer.from("replacement"),
        expectedRevision: await sha256File(source),
        sourcePath: source,
        targetPath: target,
      }),
    ).rejects.toThrow("authorized workspace");
    await expect(readFile(join(outside, "result.png"))).rejects.toBeDefined();
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
    await expect(
      artifacts.readCapabilityChunk(artifact.id, 8, 4, 4),
    ).resolves.toMatchObject({ bytes: Buffer.from("ij"), hash: artifact.hash });
    await expect(
      artifacts.readCapabilityChunk(
        "art_00000000000000000000000000000000",
        0,
        1,
        4,
      ),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it("expires artifact capabilities without retaining their staged file", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "export.png");
    await writeFile(source, "artifact");
    const artifacts = new ArtifactStore(join(root, "artifacts"), 100);
    const artifact = await artifacts.publish(source, "owner-a", 1);
    await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 10));
    await expect(
      artifacts.readCapabilityChunk(artifact.id, 0, 1, 1),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(artifacts.removeExpired()).resolves.toBe(1);
  });
  it("publishes verified export metadata in a logical opaque batch", async () => {
    const root = await temporaryDirectory();
    const first = join(root, "first.png");
    const second = join(root, "second.pdf");
    await writeFile(first, "first");
    await writeFile(second, "second");
    const artifacts = new ArtifactStore(join(root, "artifacts"), 100);
    const batch = await artifacts.publishBatch(
      [
        {
          metadata: {
            contentType: "image/png",
            export: { format: "png", verified: true },
          },
          sourcePath: first,
        },
        {
          metadata: {
            contentType: "application/pdf",
            export: { format: "pdf", verified: true },
          },
          sourcePath: second,
        },
      ],
      "owner-a",
      60_000,
    );
    expect(batch.id).toMatch(/^batch_[a-f0-9]{32}$/u);
    expect(batch.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          batchId: batch.id,
          metadata: {
            contentType: "image/png",
            export: { format: "png", verified: true },
          },
        }),
      ]),
    );
    await expect(
      artifacts.publish(first, "owner-a", 60_000, {
        contentType: "not a mime type",
      }),
    ).rejects.toThrow("metadata is invalid");
    await expect(
      artifacts.publishBatch(
        [{ sourcePath: first }, { sourcePath: join(root, "missing.png") }],
        "owner-a",
        60_000,
      ),
    ).rejects.toThrow();
    await expect(readdir(join(root, "artifacts"))).resolves.toHaveLength(2);
  });
});
