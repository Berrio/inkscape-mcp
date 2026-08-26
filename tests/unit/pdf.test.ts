import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPdf } from "../../src/export/index.js";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
describe("PDF verification", () => {
  it("requires a readable PDF and reports page count and media boxes", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-pdf-"));
    paths.push(root);
    const path = join(root, "export.pdf");
    const document = await PDFDocument.create();
    document.addPage([200, 300]);
    document.addPage([400, 500]);
    await writeFile(path, await document.save());
    await expect(verifyPdf(path)).resolves.toMatchObject({
      mediaBoxes: [
        { height: 300, width: 200 },
        { height: 500, width: 400 },
      ],
      pageCount: 2,
      version: "1.7",
    });
    await writeFile(path, "not-pdf");
    await expect(verifyPdf(path)).rejects.toThrow("not a PDF");
  });
});
