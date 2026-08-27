import { describe, expect, it } from "vitest";

import { inspectSvgPathEffects } from "../../src/documents/index.js";

describe("SVG live path effect inspection", () => {
  it("reports exact local references, including multiple effects", () => {
    const result = inspectSvgPathEffects(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs><inkscape:path-effect id="round" effect="fillet_chamfer"/><inkscape:path-effect id="bend" effect="bend_path"/><inkscape:path-effect id="roundish" effect="bspline"/></defs><path id="first" inkscape:path-effect="#round;#bend"/><path id="second" inkscape:path-effect="#roundish"/></svg>',
    );

    expect(result).toEqual({
      effects: [
        { id: "round", type: "fillet_chamfer", usedBy: ["first"] },
        { id: "bend", type: "bend_path", usedBy: ["first"] },
        { id: "roundish", type: "bspline", usedBy: ["second"] },
      ],
    });
  });

  it("rejects input that would need sanitization", () => {
    expect(() =>
      inspectSvgPathEffects(
        '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><script>bad()</script><inkscape:path-effect id="effect"/></svg>',
      ),
    ).toThrow("sanitized");
  });
});
