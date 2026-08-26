import { describe, expect, it } from "vitest";

import {
  assessSvgBounds,
  nativeVisualBoundsDescriptor,
} from "../../src/geometry/index.js";

describe("bounds fidelity contract", () => {
  it("keeps negative coordinates eligible while declaring DOM bounds approximate", () => {
    const result = assessSvgBounds(
      '<svg><rect x="-12.5" y="-8" width="20" height="10"/></svg>',
    );
    expect(result.geometric).toEqual({
      fidelity: "approximate",
      kind: "approximate",
      limitations: ["GEOMETRIC_ENGINE_UNAVAILABLE"],
      source: "dom-subset",
    });
    expect(result.visual).toEqual(nativeVisualBoundsDescriptor());
  });

  it("does not claim exact geometry for transforms, paint expansion or CSS", () => {
    const result = assessSvgBounds(`
      <svg style="--paint: currentColor">
        <style>.late { stroke-width: 10%; fill: var(--paint) !important } #field .late { stroke: #000 }</style>
        <g id="field" transform="translate(-5 -4)"><g transform="scale(2)"><rect class="late" stroke="#000"/></g></g>
        <path marker-end="url(#arrow)" filter="url(#blur)" vector-effect="non-scaling-stroke"/>
      </svg>
    `);
    expect(result.geometric.limitations).toEqual([
      "CSS_CASCADE",
      "CSS_VARIABLES_OR_CURRENT_COLOR",
      "FILTER",
      "GEOMETRIC_ENGINE_UNAVAILABLE",
      "MARKER",
      "NON_SCALING_STROKE",
      "PERCENTAGE_LENGTHS",
      "STROKE",
      "TRANSFORM",
    ]);
  });

  it("records objectBoundingBox as a distinct approximate-bounds limitation", () => {
    const result = assessSvgBounds(`
      <svg><defs><filter id="blur" filterUnits="objectBoundingBox"/></defs>
      <rect width="100%" height="20" filter="url(#blur)"/></svg>
    `);
    expect(result.geometric.limitations).toContain("OBJECT_BOUNDING_BOX");
    expect(result.geometric.limitations).toContain("PERCENTAGE_LENGTHS");
    expect(result.geometric.limitations).toContain("FILTER");
  });

  it("refuses an SVG that would need sanitization before analysis", () => {
    expect(() => assessSvgBounds("<svg><script/></svg>")).toThrow(
      "policy-compliant",
    );
  });
});
