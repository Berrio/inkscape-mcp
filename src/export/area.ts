export type ExportPageArea = {
  kind: "page";
  pageId?: string | undefined;
};
export type ExportDrawingArea = { kind: "drawing" };
export type ExportSelectionArea = { elementId: string; kind: "selection" };
export type ExportAreaRequest =
  ExportDrawingArea | ExportPageArea | ExportSelectionArea;
export type ExportPageRectangle = {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
};
export type NormalizedExportArea = {
  args: readonly string[];
  kind: ExportAreaRequest["kind"];
  pageId?: string | undefined;
  selectionId?: string | undefined;
};

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

/**
 * Translates a typed export area into fixed Inkscape arguments. It never
 * accepts raw CLI fragments and can be shared by previews and final exports.
 */
export function normalizeExportArea(
  area: ExportAreaRequest,
  pages: readonly ExportPageRectangle[],
): NormalizedExportArea {
  if (area.kind === "drawing")
    return { args: ["--export-area-drawing"], kind: "drawing" };
  if (area.kind === "selection") {
    if (!SAFE_ID.test(area.elementId))
      throw new Error("Selection ID is not valid for export");
    return {
      args: ["--export-id-only", `--export-id=${area.elementId}`],
      kind: "selection",
      selectionId: area.elementId,
    };
  }
  if (area.pageId === undefined)
    return { args: ["--export-area-page"], kind: "page" };
  const page = pages.find((candidate) => candidate.id === area.pageId);
  if (!page) throw new Error("Requested export page does not exist");
  const right = page.x + page.width;
  const bottom = page.y + page.height;
  if (
    ![page.x, page.y, right, bottom].every(Number.isFinite) ||
    right <= page.x ||
    bottom <= page.y
  )
    throw new Error("Requested export page has invalid bounds");
  return {
    args: [`--export-area=${page.x}:${page.y}:${right}:${bottom}`],
    kind: "page",
    pageId: page.id,
  };
}
