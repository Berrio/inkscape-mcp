import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectEmf,
  inspectWmf,
  parseExportSpec,
  preflightEmfExport,
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

  it("requires explicit DXF/HPGL fidelity acknowledgement and fixes adapters", () => {
    const common = {
      area: { kind: "drawing" as const },
      format: "dxf" as const,
      source: { expectedRevision: "a".repeat(64), path: "source.svg" },
      target: { kind: "file" as const, overwrite: false, path: "out.dxf" },
    };
    expect(() => parseExportSpec(common)).toThrow("fidelityPolicy");
    expect(
      parseExportSpec({
        ...common,
        fidelityPolicy: "acknowledge-limited-fidelity",
      }),
    ).toMatchObject({ format: "dxf" });
    expect(
      parseExportSpec({
        ...common,
        fidelityPolicy: "acknowledge-limited-fidelity",
        format: "hpgl",
        target: { kind: "file", overwrite: false, path: "out.hpgl" },
      }),
    ).toMatchObject({ format: "hpgl" });
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

  it("gates EMF flattening and validates its fixed binary header", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill-opacity:0.4"/></svg>';
    expect(() => preflightEmfExport(source, "reject")).toThrow(
      "requires flatten-with-warning",
    );
    expect(preflightEmfExport(source, "flatten-with-warning").warnings).toEqual(
      ["EMF_TRANSPARENCY_FLATTENING_REQUIRED"],
    );
    const emf = Buffer.alloc(88);
    emf.writeUInt32LE(1, 0);
    emf.writeUInt32LE(88, 4);
    emf.writeInt32LE(0, 24);
    emf.writeInt32LE(0, 28);
    emf.writeInt32LE(100, 32);
    emf.writeInt32LE(50, 36);
    emf.write(" EMF", 40, "ascii");
    emf.writeUInt32LE(88, 48);
    emf.writeUInt32LE(2, 52);
    expect(inspectEmf(emf)).toMatchObject({
      byteLength: 88,
      frame: [0, 0, 100, 50],
      recordCount: 2,
    });
    emf.writeUInt32LE(87, 48);
    expect(() => inspectEmf(emf)).toThrow("declared size or record count");
  });

  it("validates a placeable WMF header before experimental publication", () => {
    const wmf = Buffer.alloc(40);
    wmf.writeUInt32LE(0x9ac6cdd7, 0);
    wmf.writeInt16LE(0, 6);
    wmf.writeInt16LE(0, 8);
    wmf.writeInt16LE(100, 10);
    wmf.writeInt16LE(50, 12);
    wmf.writeUInt16LE(1440, 14);
    wmf.writeUInt16LE(1, 22);
    wmf.writeUInt16LE(9, 24);
    wmf.writeUInt16LE(0x300, 26);
    wmf.writeUInt32LE(9, 28);
    expect(inspectWmf(wmf)).toEqual({ byteLength: 40, placeable: true });
    wmf.writeUInt16LE(0, 14);
    expect(() => inspectWmf(wmf)).toThrow("placeable frame");
  });
});
