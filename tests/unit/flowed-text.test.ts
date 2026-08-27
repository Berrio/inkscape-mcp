import { describe, expect, it } from "vitest";

import {
  convertSimpleSvgFlowedText,
  inspectSvgFlowedText,
} from "../../src/documents/index.js";

const source =
  '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="story" font-size="10" fill="#112233"><flowRegion><rect x="4" y="6" width="30" height="20"/></flowRegion><flowPara>First line</flowPara><flowPara>Second line</flowPara></flowRoot></svg>';

describe("flowed text", () => {
  it("inspects flow roots without applying layout", () => {
    expect(inspectSvgFlowedText(source)).toEqual({
      flowedTexts: [{ id: "story", paragraphs: 2 }],
    });
  });

  it("converts only a simple flow root to editable text with a warning", () => {
    const result = convertSimpleSvgFlowedText(source, "story");
    expect(result.warning).toBe("FLOWED_TEXT_LAYOUT_LOST");
    expect(result.svg).toContain('<text id="story"');
    expect(result.svg).toContain('<tspan x="4" y="18">First line</tspan>');
    expect(result.svg).toContain('<tspan x="4" y="30">Second line</tspan>');
    expect(result.svg).not.toContain("flowRoot");
    expect(() =>
      convertSimpleSvgFlowedText(
        '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="bad"><flowRegion><rect/></flowRegion></flowRoot></svg>',
        "bad",
      ),
    ).toThrow("simple flowed text");
  });
});
