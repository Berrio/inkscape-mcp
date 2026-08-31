import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { DocumentResourceStore } from "../../src/server/document-resources.js";
import { JobStore } from "../../src/server/jobs.js";
import { httpOwnerScope } from "../../src/server/ownership.js";
import { ArtifactStore, sha256File } from "../../src/storage/index.js";

it("binds artifacts, document resources and jobs to an explicit HTTP principal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-owner-"));
  const sourcePath = join(directory, "document.svg");
  const source = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const workspaceId = "ws_1234567890abcdef";
  const alpha = httpOwnerScope("designer-alpha");
  const beta = httpOwnerScope("designer-beta");
  const alphaOwner = alpha.ownerForWorkspace(workspaceId);
  try {
    await writeFile(sourcePath, source, "utf8");
    expect(alphaOwner).not.toContain("designer-alpha");
    expect(alpha.owns(alphaOwner)).toBe(true);
    expect(beta.owns(alphaOwner)).toBe(false);

    const artifacts = new ArtifactStore(join(directory, "artifacts"), 1_024);
    const artifact = await artifacts.publish(sourcePath, alphaOwner, 1_000);
    await expect(
      artifacts.readScopedCapabilityChunk(artifact.id, alpha.owns, 0, 64, 64),
    ).resolves.toMatchObject({ size: Buffer.byteLength(source) });
    await expect(
      artifacts.readScopedCapabilityChunk(artifact.id, beta.owns, 0, 64, 64),
    ).rejects.toThrow("Artifact is unavailable");

    const resources = new DocumentResourceStore();
    const resource = resources.register({
      absolutePath: sourcePath,
      metadata: { kind: "metadata" },
      owner: alphaOwner,
      revision: await sha256File(sourcePath),
      summary: { kind: "summary" },
    });
    await expect(
      resources.readScopedCapability(resource.id, alpha.owns, "summary", 128),
    ).resolves.toMatchObject({ text: '{"kind":"summary"}' });
    await expect(
      resources.readScopedCapability(resource.id, beta.owns, "summary", 128),
    ).rejects.toThrow("Document resource is unavailable");

    const jobs = new JobStore();
    const job = jobs.create(alphaOwner, async () => ({ ok: true }));
    expect(() => jobs.get(job.id, beta.ownerForWorkspace(workspaceId))).toThrow(
      "Job is unavailable",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
