import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { inspectPdfImportPage } from "../../src/import/pdf-import.js";

describe("PDF import page policy", () => {
  it("returns the requested normal page dimensions", async () => {
    const document = await PDFDocument.create();
    document.addPage([72, 144]);
    document.addPage([288, 216]);

    await expect(
      inspectPdfImportPage(await document.save(), 2),
    ).resolves.toEqual({
      height: 216,
      pageCount: 2,
      width: 288,
    });
  });

  it("rejects a requested page that is absent or too large", async () => {
    const normal = await PDFDocument.create();
    normal.addPage([72, 72]);
    await expect(inspectPdfImportPage(await normal.save(), 2)).rejects.toThrow(
      "does not exist",
    );

    const huge = await PDFDocument.create();
    huge.addPage([14_401, 72]);
    await expect(inspectPdfImportPage(await huge.save(), 1)).rejects.toThrow(
      "exceeds the 200in",
    );
  });
});
