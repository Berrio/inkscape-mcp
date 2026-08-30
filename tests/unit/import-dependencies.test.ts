import { describe, expect, it } from "vitest";

import { inspectImportedSvgDependencies } from "../../src/import/dependencies.js";

const dependencySvg =
  '<svg xmlns="http://www.w3.org/2000/svg"><defs><color-profile id="press" name="FOGRA39"/></defs><text font-family="Forte, Missing Font, serif">Text</text><rect fill="icc-color(UnknownCMYK, 0, 0, 0, 1)"/></svg>';

describe("imported SVG dependency policy", () => {
  it("records unavailable fonts and unresolved profile names without claiming conversion", () => {
    expect(
      inspectImportedSvgDependencies(dependencySvg, ["Forte"], {
        fonts: "record",
        profiles: "record",
      }),
    ).toMatchObject({
      colorManagement: {
        limitations: ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"],
        unresolvedProfileNames: ["UnknownCMYK"],
      },
      fontPreflight: {
        missingFamilies: ["Missing Font"],
        presentFamilies: ["Forte"],
        warnings: expect.arrayContaining([
          "MISSING_SYSTEM_FONT_FAMILIES",
          "FONT_EMBEDDING_AND_GLYPH_COVERAGE_UNVERIFIED",
        ]),
      },
      policy: { fonts: "record", profiles: "record" },
    });
  });

  it("rejects only the dependency class selected by strict policy before publication", () => {
    expect(() =>
      inspectImportedSvgDependencies(dependencySvg, ["Forte"], {
        fonts: "reject-missing",
        profiles: "record",
      }),
    ).toThrow("unavailable system font families");
    expect(() =>
      inspectImportedSvgDependencies(dependencySvg, ["Forte", "Missing Font"], {
        fonts: "record",
        profiles: "reject-unresolved",
      }),
    ).toThrow("unresolved color profile names");
  });
});
