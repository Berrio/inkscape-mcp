import { describe, expect, it } from "vitest";
import {
  convertPhysical,
  planResize,
  toCssPixels,
  toMillimeters,
} from "../../src/geometry/index.js";
const mm = (value: number) => ({ unit: "mm" as const, value });
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
