import { describe, expect, it } from "vitest";

import {
  normalizeFontFamilies,
  preflightSvgFonts,
} from "../../src/documents/index.js";

describe("SVG font preflight", () => {
  it("distinguishes concrete, missing and generic families", () => {
    const result = preflightSvgFonts(
      '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Forte, serif">One</text><text style="font-family: Missing">Two</text></svg>',
      ["Forte", "Arial"],
    );
    expect(result.presentFamilies).toEqual(["Forte"]);
    expect(result.missingFamilies).toEqual(["Missing"]);
    expect(result.genericFamilies).toEqual(["serif"]);
    expect(result.warnings).toContain("MISSING_SYSTEM_FONT_FAMILIES");
  });

  it("normalizes bounded process output into stable family names", () => {
    expect(normalizeFontFamilies([" Forte ", "Arial", "Forte", ""])).toEqual([
      "Arial",
      "Forte",
    ]);
  });
});
