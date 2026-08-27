import { describe, expect, it } from "vitest";

import { inspectSvgColorManagement } from "../../src/documents/index.js";

describe("SVG color management inspection", () => {
  it("reports local profile metadata and ICC paint references without conversion", () => {
    expect(
      inspectSvgColorManagement(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><color-profile id="press" name="FOGRA39" rendering-intent="relative-colorimetric"/></defs><rect fill="icc-color(FOGRA39, 0.2, 0.3, 0.4, 0.1)" style="stroke:icc-color(FOGRA39, 0, 0, 0, 1)"/></svg>',
      ),
    ).toEqual({
      iccReferenceCount: 2,
      limitations: ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"],
      profiles: [
        {
          id: "press",
          name: "FOGRA39",
          renderingIntent: "relative-colorimetric",
        },
      ],
    });
  });
});
