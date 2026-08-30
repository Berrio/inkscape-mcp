import { describe, expect, it } from "vitest";

import {
  convertSimpleSvgFlowedText,
  inspectSvgFlowedText,
} from "../../src/documents/index.js";

const source =
  '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="story" font-size="10" fill="#112233" letter-spacing="1" writing-mode="vertical-rl"><flowRegion><rect x="4" y="6" width="30" height="20"/></flowRegion><flowPara>First line</flowPara><flowPara>Second line</flowPara></flowRoot></svg>';

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
    expect(result.svg).toContain('letter-spacing="1"');
    expect(result.svg).toContain('writing-mode="vertical-rl"');
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

  it("withholds unsafe IDs and rejects ambiguous or rich flowed structures", () => {
    expect(
      inspectSvgFlowedText(
        '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="legacy:story"><flowPara>Visible</flowPara></flowRoot></svg>',
      ),
    ).toEqual({ flowedTexts: [{ paragraphs: 1 }] });
    expect(() =>
      convertSimpleSvgFlowedText(
        '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="story"><flowRegion><rect/><rect/></flowRegion><flowPara>One</flowPara></flowRoot></svg>',
        "story",
      ),
    ).toThrow("simple flowed text");
    expect(() =>
      convertSimpleSvgFlowedText(
        '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="story"><flowRegion><rect/></flowRegion><flowPara><flowSpan>Styled</flowSpan></flowPara></flowRoot></svg>',
        "story",
      ),
    ).toThrow("simple flowed text");
    expect(() =>
      convertSimpleSvgFlowedText(
        '<svg xmlns="http://www.w3.org/2000/svg"><flowRoot id="story"><flowRegion><rect/></flowRegion><flowPara>One</flowPara></flowRoot><flowRoot id="story"><flowRegion><rect/></flowRegion><flowPara>Two</flowPara></flowRoot></svg>',
        "story",
      ),
    ).toThrow("exactly one");
  });
});
