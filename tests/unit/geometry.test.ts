import { describe, expect, it } from "vitest";
import {
  convertPhysical,
  planResize,
  toCssPixels,
  toMillimeters,
} from "../../src/geometry/index.js";
const mm = (value: number) => ({ unit: "mm" as const, value });
const expectMatrixClose = (
  actual: readonly number[] | undefined,
  expected: readonly number[],
) => {
  expect(actual).toHaveLength(expected.length);
  actual?.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index]!, 12),
  );
};
describe("document geometry", () => {
  it("uses 96 CSS pixels per inch with round trips", () => {
    expect(toCssPixels({ unit: "in", value: 1 })).toBeCloseTo(96);
    expect(
      convertPhysical({ unit: "mm", value: 25.4 }, "in").value,
    ).toBeCloseTo(1);
    expect(toMillimeters({ unit: "px", value: 96 })).toBeCloseTo(25.4);
  });
  it("plans normative page-only and contain/cover resize vectors", () => {
    expect(
      planResize({
        currentPage: { width: mm(210), height: mm(297) },
        currentViewBox: { x: 0, y: 0, width: 210, height: 297 },
        mode: "page_only",
        targetPage: { width: mm(148), height: mm(210) },
      }).newViewBox,
    ).toEqual({ x: 0, y: 0, width: 148, height: 210 });
    expect(
      planResize({
        currentPage: {
          width: { unit: "px", value: 800 },
          height: { unit: "px", value: 600 },
        },
        currentViewBox: { x: 0, y: 0, width: 800, height: 600 },
        mode: "scale_content_contain",
        targetPage: {
          width: { unit: "px", value: 1080 },
          height: { unit: "px", value: 1080 },
        },
      }).contentTransform,
    ).toEqual([1.35, 0, 0, 1.35, 0, 135]);
    expect(
      planResize({
        currentPage: {
          width: { unit: "px", value: 800 },
          height: { unit: "px", value: 600 },
        },
        currentViewBox: { x: 0, y: 0, width: 800, height: 600 },
        mode: "scale_content_cover",
        targetPage: {
          width: { unit: "px", value: 1080 },
          height: { unit: "px", value: 1080 },
        },
      }).contentTransform,
    ).toEqual([1.8, 0, 0, 1.8, -180, 0]);
  });
  it("applies contain and cover offsets at the requested anchors", () => {
    const currentPage = {
      width: { unit: "px" as const, value: 800 },
      height: { unit: "px" as const, value: 600 },
    };
    const currentViewBox = { x: 0, y: 0, width: 800, height: 600 };
    const targetPage = {
      width: { unit: "px" as const, value: 1080 },
      height: { unit: "px" as const, value: 1080 },
    };
    expectMatrixClose(
      planResize({
        anchor: "top_left",
        currentPage,
        currentViewBox,
        mode: "scale_content_contain",
        targetPage,
      }).contentTransform,
      [1.35, 0, 0, 1.35, 0, 0],
    );
    expectMatrixClose(
      planResize({
        anchor: "bottom_right",
        currentPage,
        currentViewBox,
        mode: "scale_content_contain",
        targetPage,
      }).contentTransform,
      [1.35, 0, 0, 1.35, 0, 270],
    );
    expectMatrixClose(
      planResize({
        anchor: "top_left",
        currentPage,
        currentViewBox,
        mode: "scale_content_cover",
        targetPage,
      }).contentTransform,
      [1.8, 0, 0, 1.8, 0, 0],
    );
    expectMatrixClose(
      planResize({
        anchor: "bottom_right",
        currentPage,
        currentViewBox,
        mode: "scale_content_cover",
        targetPage,
      }).contentTransform,
      [1.8, 0, 0, 1.8, -360, 0],
    );
  });
  it("keeps the requested resize anchor fixed", () => {
    expect(
      planResize({
        anchor: "bottom_right",
        currentPage: { width: mm(210), height: mm(297) },
        currentViewBox: { x: 0, y: 0, width: 210, height: 297 },
        mode: "page_only",
        targetPage: { width: mm(148), height: mm(210) },
      }).newViewBox,
    ).toEqual({ x: 62, y: 87, width: 148, height: 210 });
  });
});
