import { describe, expect, it } from "vitest";
import {
  convertPhysical,
  planResize,
  toCssPixels,
  toMillimeters,
} from "../../src/geometry/index.js";
const mm = (value: number) => ({ unit: "mm" as const, value });
const NORMATIVE_GEOMETRY_DECIMALS = 12;
const expectMatrixClose = (
  actual: readonly number[] | undefined,
  expected: readonly number[],
) => {
  expect(actual).toHaveLength(expected.length);
  actual?.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index]!, NORMATIVE_GEOMETRY_DECIMALS),
  );
};
const expectRectClose = (
  actual: { height: number; width: number; x: number; y: number },
  expected: { height: number; width: number; x: number; y: number },
) => {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], NORMATIVE_GEOMETRY_DECIMALS);
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
  it("F03-G07 applies the first four section 10 normative vectors", () => {
    const a4Page = { width: mm(210), height: mm(297) };
    const a4ViewBox = { x: 0, y: 0, width: 210, height: 297 };
    const a5Page = { width: mm(148), height: mm(210) };
    const doubledA4Page = { width: mm(420), height: mm(594) };
    const preservedUserScale = planResize({
      currentPage: a4Page,
      currentViewBox: a4ViewBox,
      mode: "page_only",
      targetPage: a5Page,
    });
    expectRectClose(preservedUserScale.newViewBox, {
      x: 0,
      y: 0,
      width: 148,
      height: 210,
    });
    expect(preservedUserScale.warnings).toEqual([]);

    const preservedViewBox = planResize({
      currentPage: a4Page,
      currentViewBox: a4ViewBox,
      mode: "page_only",
      policy: "preserve_viewbox",
      targetPage: doubledA4Page,
    });
    expectRectClose(preservedViewBox.newViewBox, a4ViewBox);
    expect(
      toCssPixels(doubledA4Page.width) / toCssPixels(a4Page.width),
    ).toBeCloseTo(2, NORMATIVE_GEOMETRY_DECIMALS);
    expect(
      toCssPixels(doubledA4Page.height) / toCssPixels(a4Page.height),
    ).toBeCloseTo(2, NORMATIVE_GEOMETRY_DECIMALS);
    expect(preservedViewBox.warnings).toEqual(["DOCUMENT_SCALE_CHANGED"]);

    const currentPage = {
      width: { unit: "px" as const, value: 800 },
      height: { unit: "px" as const, value: 600 },
    };
    const targetPage = {
      width: { unit: "px" as const, value: 1080 },
      height: { unit: "px" as const, value: 1080 },
    };
    const contain = planResize({
      currentPage,
      currentViewBox: { x: 0, y: 0, width: 800, height: 600 },
      mode: "scale_content_contain",
      targetPage,
    });
    expectMatrixClose(contain.contentTransform, [1.35, 0, 0, 1.35, 0, 135]);
    expect(contain.warnings).toEqual([]);

    const cover = planResize({
      currentPage,
      currentViewBox: { x: 0, y: 0, width: 800, height: 600 },
      mode: "scale_content_cover",
      targetPage,
    });
    expectMatrixClose(cover.contentTransform, [1.8, 0, 0, 1.8, -180, 0]);
    expect(cover.warnings).toEqual(["CONTENT_MAY_BE_CROPPED"]);
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
