import { describe, expect, it } from "vitest";

import { normalizeSvgIds } from "../../src/svg/index.js";

describe("SVG ID normalization", () => {
  it("rewrites unsafe IDs and their local href/url/ARIA/CSS references", () => {
    const source =
      '<svg><defs><linearGradient id="legacy:gradient"/><clipPath id="clip"/></defs><style>#legacy\\:gradient, .item { fill:url(#legacy:gradient); }</style><rect id="duplicate" fill="url(#legacy:gradient)" clip-path="url(#clip)" aria-labelledby="legacy:gradient clip"/><use href="#legacy:gradient"/><rect id="duplicate"/></svg>';
    const result = normalizeSvgIds(source);
    const renamed = result.renamed.find(
      (item) => item.from === "legacy:gradient",
    );
    expect(renamed?.reason).toBe("invalid");
    expect(renamed?.to).toMatch(/^svg_linearGradient_\d+$/u);
    expect(result.svg).not.toContain('id="legacy:gradient"');
    expect(result.svg).toContain(`href="#${renamed?.to}"`);
    expect(result.svg).toContain(`url(#${renamed?.to})`);
    expect(result.svg).toContain(`#${renamed?.to}, .item`);
    expect(result.svg).toContain(`aria-labelledby="${renamed?.to} clip"`);
    expect(result.renamed).toContainEqual({
      from: "duplicate",
      reason: "duplicate",
      to: expect.stringMatching(/^svg_rect_\d+$/u),
    });
  });

  it("optionally assigns deterministic public IDs without changing valid IDs", () => {
    const result = normalizeSvgIds(
      '<svg><rect id="existing"/><circle/></svg>',
      { assignMissingIds: true, prefix: "asset" },
    );
    expect(result.svg).toContain('id="existing"');
    expect(result.renamed).toContainEqual({
      reason: "missing",
      to: "asset_svg_1",
    });
    expect(result.renamed).toContainEqual({
      reason: "missing",
      to: "asset_circle_2",
    });
  });

  it("rejects prefixes that cannot make a public SVG ID", () => {
    expect(() => normalizeSvgIds("<svg/>", { prefix: "1bad" })).toThrow(
      "prefix",
    );
  });
});
