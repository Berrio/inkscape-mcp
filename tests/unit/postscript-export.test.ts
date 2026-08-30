import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseExportSpec,
  preflightPostscriptExport,
  verifyExportArtifact,
} from "../../src/export/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("PostScript export policy and verification", () => {
  it("rejects transparency unless the caller explicitly accepts rasterization", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect opacity="0.5" filter="url(#blur)"/></svg>';
    expect(() => preflightPostscriptExport(source, "reject")).toThrow(
      "requires rasterize-with-warning",
    );
    expect(
      preflightPostscriptExport(source, "rasterize-with-warning").warnings,
    ).toEqual([
      "POSTSCRIPT_FILTER_RASTERIZATION_REQUIRED",
      "POSTSCRIPT_TRANSPARENCY_RASTERIZATION_REQUIRED",
    ]);
  });

  it("keeps EPS restricted to drawing/selection and defaults to rejection", () => {
    const revision = "a".repeat(64);
    const common = {
      level: 3,
      source: { expectedRevision: revision, path: "source.svg" },
      target: { kind: "file" as const, overwrite: false, path: "out.eps" },
      text: "preserve" as const,
    };
    expect(
      parseExportSpec({ ...common, area: { kind: "drawing" }, format: "eps" }),
    ).toMatchObject({ rasterizationPolicy: "reject" });
    expect(() =>
      parseExportSpec({
        ...common,
        area: { kind: "pages", pageIds: ["page_1"] },
        format: "eps",
      }),
    ).toThrow();
  });

  it("verifies PostScript signatures and requires a concrete EPS bounding box", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-ps-"));
    directories.push(directory);
    const ps = join(directory, "output.ps");
    const eps = join(directory, "output.eps");
    await writeFile(ps, "%!PS-Adobe-3.0\n%%EndComments\nshowpage\n", "ascii");
    await writeFile(
      eps,
      "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n%%EndComments\nshowpage\n",
      "ascii",
    );
    await expect(verifyExportArtifact("ps", ps)).resolves.toMatchObject({
      format: "ps",
    });
    await expect(verifyExportArtifact("eps", eps)).resolves.toMatchObject({
      format: "eps",
      metadata: { boundingBox: [0, 0, 100, 50] },
    });
    await writeFile(
      eps,
      "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: (atend)\n%%EndComments\n",
      "ascii",
    );
    await expect(verifyExportArtifact("eps", eps)).rejects.toThrow(
      "concrete BoundingBox",
    );
  });
});
