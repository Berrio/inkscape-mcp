import { describe, expect, it } from "vitest";

import {
  createSvgSymbol,
  createSvgUseClone,
  deleteSvgSymbol,
  listSvgSymbols,
} from "../../src/documents/index.js";

describe("SVG symbols and use clones", () => {
  const base =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="badge" width="10" height="5"/></svg>';

  it("creates a reusable symbol and positioned local use clone", () => {
    const symbolized = createSvgSymbol(base, {
      id: "badge_symbol",
      sourceId: "badge",
      viewBox: [0, 0, 10, 5],
    });
    expect(symbolized).toContain(
      '<symbol id="badge_symbol" viewBox="0 0 10 5"><use href="#badge"/></symbol>',
    );
    const cloned = createSvgUseClone(symbolized, {
      id: "badge_copy",
      sourceId: "badge_symbol",
      x: 12,
      y: 3,
    });
    expect(cloned).toContain(
      '<use id="badge_copy" href="#badge_symbol" x="12" y="3"/>',
    );
    expect(listSvgSymbols(cloned)).toEqual([
      { id: "badge_symbol", viewBox: [0, 0, 10, 5] },
    ]);
  });

  it("protects use references and rejects existing cyclic graphs", () => {
    const symbolized = createSvgSymbol(base, {
      id: "badge_symbol",
      sourceId: "badge",
    });
    const cloned = createSvgUseClone(symbolized, {
      id: "badge_copy",
      sourceId: "badge_symbol",
    });
    expect(() => deleteSvgSymbol(cloned, "badge_symbol")).toThrow(
      "break an SVG use reference",
    );
    expect(() =>
      listSvgSymbols(
        '<svg xmlns="http://www.w3.org/2000/svg"><use id="a" href="#b"/><use id="b" href="#a"/></svg>',
      ),
    ).toThrow("cycle");
  });
});
