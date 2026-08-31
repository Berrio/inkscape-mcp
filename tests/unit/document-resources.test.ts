import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentResourceStore,
  ExportManifestResourceStore,
} from "../../src/server/document-resources.js";
import { RevisionConflictError, sha256File } from "../../src/storage/index.js";

const directories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-resource-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("DocumentResourceStore", () => {
  it("issues opaque revision-pinned metadata, summary and SVG capabilities", async () => {
    const directory = await fixtureDirectory();
    const document = join(directory, "label.svg");
    await writeFile(document, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const resources = new DocumentResourceStore();
    const registered = resources.register({
      absolutePath: document,
      metadata: { pageCount: 1 },
      owner: "ws_owner",
      revision: await sha256File(document),
      summary: { warningCount: 0 },
    });
    expect(registered).toMatchObject({
      metadataUri: expect.stringMatching(
        /^inkscape:\/\/document\/doc_[a-f0-9]{32}\/metadata$/u,
      ),
      summaryUri: expect.stringMatching(
        /^inkscape:\/\/document\/doc_[a-f0-9]{32}\/summary$/u,
      ),
      svgUri: expect.stringMatching(
        /^inkscape:\/\/document\/doc_[a-f0-9]{32}\/svg$/u,
      ),
    });
    expect(JSON.stringify(registered)).not.toContain(directory);
    await expect(
      resources.readOwned(registered.id, "ws_owner", "metadata", 1_024),
    ).resolves.toMatchObject({
      mimeType: "application/json",
      text: '{"pageCount":1}',
    });
    await expect(
      resources.readOwned(registered.id, "ws_other", "summary", 1_024),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      resources.readCapability(registered.id, "svg", 1_024),
    ).resolves.toMatchObject({ mimeType: "image/svg+xml" });
  });

  it("rejects expired, stale and oversized SVG resource reads", async () => {
    const directory = await fixtureDirectory();
    const document = join(directory, "stale.svg");
    await writeFile(document, "<svg/>");
    const resources = new DocumentResourceStore(1);
    const stale = resources.register({
      absolutePath: document,
      metadata: {},
      owner: "ws_owner",
      revision: await sha256File(document),
      summary: {},
      ttlMs: 60_000,
    });
    await writeFile(document, "<svg><rect/></svg>");
    await expect(
      resources.readCapability(stale.id, "metadata", 1_024),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    const oversized = resources.register({
      absolutePath: document,
      metadata: {},
      owner: "ws_owner",
      revision: await sha256File(document),
      summary: {},
    });
    await expect(
      resources.readCapability(oversized.id, "svg", 1),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    const expired = resources.register({
      absolutePath: document,
      metadata: {},
      owner: "ws_owner",
      revision: await sha256File(document),
      summary: {},
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(
      resources.readCapability(expired.id, "summary", 1_024),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(resources.removeExpired()).resolves.toBeGreaterThanOrEqual(1);
  });

  it("expires opaque export-manifest capabilities", async () => {
    const resources = new ExportManifestResourceStore(1);
    const resource = resources.register("job_123", "ws_owner");
    expect(resource.uri).toMatch(
      /^inkscape:\/\/export\/exp_[a-f0-9]{32}\/manifest$/u,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await expect(resources.resolve(resource.id)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
    await expect(resources.removeExpired()).resolves.toBeGreaterThanOrEqual(1);
  });
});
