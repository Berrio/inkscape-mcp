export type ExportPageArea = {
  kind: "page";
  pageId?: string | undefined;
  pageIds?: readonly string[] | undefined;
};
export type ExportDrawingArea = { kind: "drawing" };
export type ExportCustomArea = {
  kind: "custom";
  rect: { height: number; width: number; x: number; y: number };
};
export type ExportSelectionArea =
  | { elementId: string; kind: "selection" }
  | {
      elementIds: readonly string[];
      kind: "selection";
      output: "combined" | "each";
      visibility: "document" | "selected-only";
    };
export type ExportAreaRequest =
  ExportDrawingArea | ExportPageArea | ExportCustomArea | ExportSelectionArea;
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
    const elementId = "elementId" in area ? area.elementId : area.elementIds[0];
    if (
      elementId === undefined ||
      ("elementIds" in area &&
        (area.elementIds.length !== 1 || area.output !== "combined")) ||
      !SAFE_ID.test(elementId)
    )
      throw new Error("Selection ID is not valid for export");
    return {
      args: ["--export-id-only", `--export-id=${elementId}`],
      kind: "selection",
      selectionId: elementId,
    };
  }
  if (area.kind === "custom") {
    const right = area.rect.x + area.rect.width;
    const bottom = area.rect.y + area.rect.height;
    if (
      ![area.rect.x, area.rect.y, right, bottom].every(Number.isFinite) ||
      right <= area.rect.x ||
      bottom <= area.rect.y
    )
      throw new Error("Custom export area has invalid bounds");
    return {
      args: [`--export-area=${area.rect.x}:${area.rect.y}:${right}:${bottom}`],
      kind: "custom",
    };
  }
  const pageId = area.pageId ?? area.pageIds?.[0];
  if (
    (area.pageIds !== undefined && area.pageIds.length !== 1) ||
    (area.pageId !== undefined &&
      area.pageIds !== undefined &&
      area.pageIds[0] !== area.pageId)
  )
    throw new Error("Multiple export pages require variant planning");
  if (pageId === undefined)
    return { args: ["--export-area-page"], kind: "page" };
  const page = pages.find((candidate) => candidate.id === pageId);
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
