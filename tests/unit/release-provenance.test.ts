import { describe, expect, it } from "vitest";

import {
  createChecksumText,
  createProvenance,
  resolveReleaseDirectory,
} from "../../scripts/release-provenance.mjs";

describe("release provenance", () => {
  it("keeps generated evidence below the repository and sorts checksums", () => {
    expect(resolveReleaseDirectory("artifacts/releases/0.1.0")).toContain(
      "artifacts",
    );
    expect(() => resolveReleaseDirectory("..")).toThrow(
      "must stay below the repository",
    );
    expect(
      createChecksumText([
        { fileName: "z.tgz", sha256: "z" },
        { fileName: "a.spdx.json", sha256: "a" },
      ]),
    ).toBe("a *a.spdx.json\nz *z.tgz\n");
  });

  it("records only hashes for immutable release artifacts", () => {
    const provenance = createProvenance({
      artifacts: [{ fileName: "inkscape-mcp-0.1.0.tgz", sha256: "abc123" }],
      commit: "a".repeat(40),
      generatedAt: "2026-08-27T00:00:00.000Z",
      npmVersion: "11.16.0",
    });

    expect(provenance).toMatchObject({
      artifacts: [{ fileName: "inkscape-mcp-0.1.0.tgz", sha256: "abc123" }],
      git: { commit: "a".repeat(40), treeState: "clean" },
      package: { name: "inkscape-mcp", private: false, version: "0.1.0" },
      schema: "inkscape-mcp-release-provenance/v1",
    });
  });
});
