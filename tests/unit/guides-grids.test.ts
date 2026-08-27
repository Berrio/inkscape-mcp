import { describe, expect, it } from "vitest";

import {
  createSvgGrid,
  createSvgGuide,
  deleteSvgGuide,
  inspectSvgGuidesAndGrids,
  updateSvgGrid,
  updateSvgGuide,
} from "../../src/documents/index.js";

describe("document-local Inkscape guides and grids", () => {
  const base = '<svg xmlns="http://www.w3.org/2000/svg"/>'.toString();

  it("creates, updates, reads and deletes document-local guides", () => {
    const created = createSvgGuide(base, {
      id: "guide_left",
      label: "Cut line",
      orientation: "vertical",
      position: [10, 0],
    });
    expect(created).toContain(
      'sodipodi:guide id="guide_left" position="10,0" orientation="1,0"',
    );
    const updated = updateSvgGuide(created, "guide_left", {
      orientation: "horizontal",
      position: [0, 4],
    });
    expect(inspectSvgGuidesAndGrids(updated).guides).toEqual([
      {
        id: "guide_left",
        label: "Cut line",
        orientation: "horizontal",
        position: [0, 4],
      },
    ]);
    expect(deleteSvgGuide(updated, "guide_left")).not.toContain("guide_left");
  });

  it("keeps xygrids in document metadata with typed dimensions", () => {
    const created = createSvgGrid(base, {
      enabled: true,
      id: "grid_mm",
      origin: [0, 0],
      spacing: [5, 5],
      type: "xygrid",
      visible: true,
    });
    const updated = updateSvgGrid(created, "grid_mm", {
      enabled: false,
      origin: [2, 3],
      spacing: [2.5, 4],
    });
    expect(inspectSvgGuidesAndGrids(updated).grids).toEqual([
      {
        enabled: false,
        id: "grid_mm",
        origin: [2, 3],
        spacing: [2.5, 4],
        type: "xygrid",
        visible: true,
      },
    ]);
    expect(() =>
      createSvgGrid(base, {
        enabled: true,
        id: "bad_grid",
        origin: [0, 0],
        spacing: [0, 1],
        type: "xygrid",
        visible: true,
      }),
    ).toThrow("positive");
  });
});
