import { describe, expect, it } from "vitest";

import {
  extractSvgSelection,
  rewriteStagedAssetReferences,
} from "../../src/documents/index.js";

describe("selection SVG export", () => {
  it("keeps only selected content and its referenced definition", () => {
    const result = extractSvgSelection(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="paint"><stop/></linearGradient><filter id="unused"/></defs><rect id="selected" fill="url(#paint)"/><circle id="other"/></svg>',
      ["selected"],
    );
    expect(result.svg).toContain("linearGradient");
    expect(result.svg).toContain("selected");
    expect(result.svg).not.toContain('id="other"');
    expect(result.svg).not.toContain('id="unused"');
  });
  it("rejects missing references and flattens supported stylesheet dependencies", () => {
    expect(() =>
      extractSvgSelection(
        '<svg viewBox="0 0 1 1"><rect id="one" fill="url(#missing)"/></svg>',
        ["one"],
      ),
    ).toThrow("unresolved reference");
    const styled = extractSvgSelection(
      '<svg viewBox="0 0 1 1"><style>.x { fill: url(#paint); }</style><defs><linearGradient id="paint"><stop/></linearGradient></defs><rect id="one" class="x"/></svg>',
      ["one"],
    );
    expect(styled.svg).toContain('style="fill:url(#paint) !important"');
    expect(styled.svg).toContain('id="paint"');
    expect(styled.warnings).toEqual(["SELECTION_CSS_FLATTENED_SUPPORTED"]);
  });
  it("preserves ancestor transforms and fails closed on reference cycles", () => {
    const result = extractSvgSelection(
      '<svg viewBox="0 0 1 1"><g id="parent" transform="translate(2)"><rect id="one" fill="red"/></g></svg>',
      ["one"],
    );
    expect(result.svg).toContain('transform="translate(2)"');
    expect(result.svg).toContain('id="one"');
    expect(result.svg).not.toContain('id="parent"');
    expect(() =>
      extractSvgSelection(
        '<svg viewBox="0 0 1 1"><defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><rect id="one" fill="url(#a)"/></svg>',
        ["one"],
      ),
    ).toThrow("cyclic reference");
  });

  it("keeps unique ancestor IDs needed by contextual stylesheet selectors", () => {
    const result = extractSvgSelection(
      '<svg viewBox="0 0 1 1"><style>#card .title { fill: #c00; }</style><g id="card" transform="translate(2)"><text id="title" class="title">Hi</text></g></svg>',
      ["title"],
    );
    expect(result.svg).toContain('id="card"');
    expect(result.svg).toContain("#card .title");
    expect(result.warnings).toEqual(["SELECTION_STYLESHEET_PRESERVED_PARTIAL"]);
  });

  it("flattens the supported computed CSS cascade and retains its paint closure", () => {
    const result = extractSvgSelection(
      '<svg viewBox="0 0 1 1"><style>g { fill: url(#paint); font-family: Design; } .chosen { stroke: #123456; }</style><defs><linearGradient id="paint"><stop/></linearGradient><filter id="unused"/></defs><g transform="translate(2)"><rect id="one" class="chosen" width="1" height="1"/></g><circle id="other"/></svg>',
      ["one"],
    );
    expect(result.svg).not.toContain("<style");
    expect(result.svg).toContain(
      'style="fill:url(#paint) !important;font-family:Design !important;stroke:#123456 !important"',
    );
    expect(result.svg).toContain('id="paint"');
    expect(result.svg).not.toContain('id="unused"');
    expect(result.warnings).toEqual(["SELECTION_CSS_FLATTENED_SUPPORTED"]);
  });
});

describe("selection asset publication", () => {
  it("rewrites only staged asset URIs in SVG and CSS", () => {
    const result = rewriteStagedAssetReferences(
      '<svg><style>@import "assets/0001-font.css"; .x { fill: url(assets/0000-image.png#fragment); }</style><image href="assets/0000-image.png"/><text>assets/0000-image.png</text></svg>',
      new Map([
        ["assets/0000-image.png", "export.svg.assets/0000-image.png"],
        ["assets/0001-font.css", "export.svg.assets/0001-font.css"],
      ]),
    );
    expect(result).toContain("export.svg.assets/0000-image.png#fragment");
    expect(result).toContain("export.svg.assets/0001-font.css");
    expect(result).toContain("<text>assets/0000-image.png</text>");
  });

  it("rejects active or remote SVG before parsing it for publication", () => {
    expect(() =>
      rewriteStagedAssetReferences(
        '<svg><script>run()</script><image href="https://evil.invalid/x.png"/></svg>',
        new Map([["assets/a.png", "export.svg.assets/a.png"]]),
      ),
    ).toThrow("sanitized before publishing");
  });
});
