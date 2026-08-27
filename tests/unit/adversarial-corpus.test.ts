import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyPdf, verifyPng } from "../../src/export/index.js";
import { inspectRasterImport } from "../../src/import/raster-import.js";
import { sanitizeSvg } from "../../src/svg/index.js";

const paths: string[] = [];
const svgLimits = {
  maxElements: 20,
  maxInputBytes: 16_384,
  mode: "strict" as const,
};

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function writeCorpusFile(
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-adversarial-"));
  paths.push(root);
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}

describe("adversarial input corpus", () => {
  it("rejects active, malformed and structurally excessive SVG deterministically", () => {
    const rejected = [
      { id: "svg-doctype", source: "<!DOCTYPE svg><svg/>" },
      { id: "svg-entity", source: '<!ENTITY x "boom"><svg/>' },
      { id: "svg-cdata", source: "<svg><![CDATA[<script/>]]></svg>" },
      { id: "svg-wrong-root", source: "<html/>" },
      {
        id: "svg-too-many-elements",
        source: `<svg>${"<rect/>".repeat(20)}</svg>`,
      },
      {
        id: "svg-too-deep",
        source: `<svg>${"<g>".repeat(257)}<rect/>${"</g>".repeat(257)}</svg>`,
      },
    ];
    for (const fixture of rejected)
      expect(
        () => sanitizeSvg(fixture.source, svgLimits),
        fixture.id,
      ).toThrow();

    const sanitized = sanitizeSvg(
      '<svg><style>@import url(https://evil.invalid/font.css)</style><image href="//evil.invalid/image.png" onerror="run()"/></svg>',
      svgLimits,
    );
    expect(sanitized.svg).not.toContain("evil.invalid");
    expect(sanitized.svg).not.toContain("onerror");
  });

  it("rejects malformed and truncated PDF artifacts before they are published", async () => {
    const corpus = [
      { id: "pdf-not-a-pdf", bytes: Buffer.from("not a PDF") },
      { id: "pdf-truncated-header", bytes: Buffer.from("%PDF-1.7\n") },
      {
        id: "pdf-truncated-object",
        bytes: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n"),
      },
    ];
    for (const fixture of corpus) {
      const path = await writeCorpusFile(`${fixture.id}.pdf`, fixture.bytes);
      await expect(verifyPdf(path), fixture.id).rejects.toThrow();
    }
  });

  it("rejects truncated, checksum-corrupt and oversized raster headers", async () => {
    const signatureOnly = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fakeHeader = Buffer.alloc(33);
    signatureOnly.copy(fakeHeader);
    fakeHeader.writeUInt32BE(13, 8);
    fakeHeader.write("IHDR", 12, "ascii");
    fakeHeader.writeUInt32BE(100_000, 16);
    fakeHeader.writeUInt32BE(100_000, 20);
    fakeHeader[24] = 8;
    fakeHeader[25] = 6;
    const path = await writeCorpusFile("png-signature-only.png", signatureOnly);
    await expect(verifyPng(path)).rejects.toThrow();
    expect(() => inspectRasterImport(signatureOnly, 1)).toThrow();
    expect(() => inspectRasterImport(fakeHeader, 100)).toThrow();
    expect(() =>
      inspectRasterImport(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00]), 100),
    ).toThrow();
  });
});
