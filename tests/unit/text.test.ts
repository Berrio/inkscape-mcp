import { describe, expect, it } from "vitest";

import { updateSvgText } from "../../src/documents/index.js";

describe("typed SVG text editing", () => {
  it("updates leaf segments while retaining tspan structure", () => {
    const result = updateSvgText(
      '<svg xmlns="http://www.w3.org/2000/svg"><text id="label">Hello<tspan dx="2"> world</tspan></text></svg>',
      {
        id: "label",
        mode: "preserve_structure",
        segments: ["Hola", " mundo"],
        layout: {
          direction: "ltr",
          letterSpacing: 0.2,
          writingMode: "horizontal-tb",
        },
      },
    );
    expect(result).toContain('>Hola<tspan dx="2"> mundo</tspan></text>');
    expect(result).toContain('letter-spacing="0.2"');
  });

  it("replaces content with safe multiline tspans", () => {
    const result = updateSvgText(
      '<svg xmlns="http://www.w3.org/2000/svg"><text id="label" x="5">old</text></svg>',
      {
        id: "label",
        lineHeight: 14,
        lines: [[{ text: "First" }], [{ dx: 1, text: "Second" }]],
        mode: "replace_structure",
        layout: { baseline: "middle", textAnchor: "middle", wordSpacing: 2 },
      },
    );
    expect(result).toContain('<tspan x="5"><tspan>First</tspan></tspan>');
    expect(result).toContain(
      '<tspan x="5" dy="14"><tspan dx="1">Second</tspan></tspan>',
    );
    expect(result).toContain('dominant-baseline="middle"');
  });
});
