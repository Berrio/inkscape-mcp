import { expect, it } from "vitest";

import { normalizeExportArea } from "../../src/export/index.js";

const pages = [{ height: 20, id: "page_front", width: 10, x: -2, y: 3 }];

it("normalizes page, drawing and single-selection export areas without raw argv", () => {
  expect(normalizeExportArea({ kind: "drawing" }, pages)).toEqual({
    args: ["--export-area-drawing"],
    kind: "drawing",
  });
  expect(normalizeExportArea({ kind: "page" }, pages)).toEqual({
    args: ["--export-area-page"],
    kind: "page",
  });
  expect(
    normalizeExportArea({ kind: "page", pageId: "page_front" }, pages),
  ).toEqual({
    args: ["--export-area=-2:3:8:23"],
    kind: "page",
    pageId: "page_front",
  });
  expect(
    normalizeExportArea({ elementId: "selected_1", kind: "selection" }, pages),
  ).toEqual({
    args: ["--export-id-only", "--export-id=selected_1"],
    kind: "selection",
    selectionId: "selected_1",
  });
});

it("rejects non-existent pages and unsafe selection IDs", () => {
  expect(() =>
    normalizeExportArea({ kind: "page", pageId: "page_missing" }, pages),
  ).toThrow("does not exist");
  expect(() =>
    normalizeExportArea({ elementId: "x --bad", kind: "selection" }, pages),
  ).toThrow("not valid");
});
