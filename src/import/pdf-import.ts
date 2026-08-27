import { PDFDocument } from "pdf-lib";

const MAX_PAGE_AREA_POINTS_SQUARED = 50_000_000;
const MAX_PAGE_DIMENSION_POINTS = 14_400;

export type PdfImportPage = {
  height: number;
  pageCount: number;
  width: number;
};

/** Validates the selected PDF page before invoking the native importer. */
export async function inspectPdfImportPage(
  bytes: Uint8Array,
  page: number,
): Promise<PdfImportPage> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("PDF import source is not a readable PDF");
  }
  const pages = document.getPages();
  if (page > pages.length)
    throw new Error(`PDF import page ${page} does not exist in this document`);
  const mediaBox = pages[page - 1]!.getMediaBox();
  const width = Math.abs(mediaBox.width);
  const height = Math.abs(mediaBox.height);
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_PAGE_DIMENSION_POINTS ||
    height > MAX_PAGE_DIMENSION_POINTS ||
    width * height > MAX_PAGE_AREA_POINTS_SQUARED
  )
    throw new Error(
      "PDF import page exceeds the 200in / 50,000,000pt² import policy",
    );
  return { height, pageCount: pages.length, width };
}
