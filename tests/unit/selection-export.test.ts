import { describe, expect, it } from "vitest";

import { extractSvgSelection } from "../../src/documents/index.js";

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
  it("rejects missing references and stylesheet closure it cannot preserve", () => {
    expect(() =>
      extractSvgSelection(
        '<svg viewBox="0 0 1 1"><rect id="one" fill="url(#missing)"/></svg>',
        ["one"],
      ),
    ).toThrow("unresolved reference");
    expect(() =>
      extractSvgSelection(
        '<svg viewBox="0 0 1 1"><style>.x { fill: red; }</style><rect id="one" class="x"/></svg>',
        ["one"],
      ),
    ).toThrow("stylesheet closure");
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
});
