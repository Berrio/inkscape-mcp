import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

export type PdfMetadata = {
  mediaBoxes: readonly { height: number; width: number }[];
  pageCount: number;
  version: string;
};

export async function verifyPdf(path: string): Promise<PdfMetadata> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 16).toString("ascii");
  const match = header.match(/^%PDF-(1\.[0-9])/u);
  if (!match) throw new Error("Export output is not a PDF");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("Export output is not a readable PDF");
  }
  const mediaBoxes = document.getPages().map((page) => {
    const box = page.getMediaBox();
    return { height: box.height, width: box.width };
  });
  if (mediaBoxes.length === 0) throw new Error("Export PDF has no pages");
  return { mediaBoxes, pageCount: mediaBoxes.length, version: match[1]! };
}
