import { describe, expect, it } from "vitest";

import {
  applySvgPalette,
  inspectSvgPalette,
} from "../../src/documents/index.js";

describe("document palette", () => {
  it("counts direct local paint colors deterministically", () => {
    expect(
      inspectSvgPalette(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#FF0000" stroke="#0000ff"/><circle fill="#ff0000"/><stop stop-color="#00ff00"/></svg>',
      ),
    ).toEqual({
      colors: [
        { color: "#ff0000", uses: 2 },
        { color: "#0000ff", uses: 1 },
        { color: "#00ff00", uses: 1 },
      ],
      cssVariables: [],
      swatches: [],
      truncated: false,
    });
  });

  it("inspects and recolors named solid Inkscape swatches", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><defs><linearGradient id="brand" inkscape:swatch="solid" inkscape:label="Marca"><stop style="stop-color:#FF0000;stop-opacity:1"/></linearGradient></defs><rect fill="url(#brand)"/></svg>';
    expect(inspectSvgPalette(source).swatches).toEqual([
      { color: "#ff0000", id: "brand", name: "Marca" },
    ]);
    const result = applySvgPalette(source, [
      { from: "#ff0000", to: "#112233" },
    ]);
    expect(result.replacements).toBe(1);
    expect(result.svg).toContain("stop-color:#112233");
  });

  it("invents and rewrites local CSS variable values without touching global preferences", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>:root { --brand: #FF0000; } .label { fill: var(--brand); stroke: var(--brand, #000000); }</style><rect class="label"/></svg>';
    expect(inspectSvgPalette(source).cssVariables).toEqual([
      { color: "#ff0000", name: "--brand", uses: 2 },
    ]);
    const result = applySvgPalette(source, [
      { from: "#ff0000", to: "#112233" },
    ]);
    expect(result.replacements).toBe(1);
    expect(result.svg).toContain("--brand: #112233");
    expect(result.svg).toContain("var(--brand)");
  });

  it("applies an explicit local mapping to attributes and inline paint styles", () => {
    const result = applySvgPalette(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#FF0000" stroke="#00ff00" style="fill:#ff0000"/><stop stop-color="#ff0000"/></svg>',
      [{ from: "#ff0000", to: "#112233" }],
    );
    expect(result.replacements).toBe(3);
    expect(result.svg).toContain('fill="#112233"');
    expect(result.svg).toContain('stop-color="#112233"');
    expect(result.svg).toContain('stroke="#00ff00"');
    expect(result.svg).toContain('style="fill:#112233"');
    expect(() =>
      applySvgPalette("<svg/>", [
        { from: "#000000", to: "#111111" },
        { from: "#000000", to: "#222222" },
      ]),
    ).toThrow("duplicate");
  });

  it("counts and recolors every explicit stop in a multistop gradient", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky"><stop offset="0" stop-color="#112233"/><stop offset="0.5" style="stop-color:#445566;stop-opacity:1"/><stop offset="1" stop-color="#112233"/></linearGradient></defs><rect style="fill:#445566;stroke:#778899" fill="url(#sky)"/></svg>';
    expect(inspectSvgPalette(source).colors).toEqual([
      { color: "#112233", uses: 2 },
      { color: "#445566", uses: 2 },
      { color: "#778899", uses: 1 },
    ]);
    const result = applySvgPalette(source, [
      { from: "#112233", to: "#abcdef" },
      { from: "#445566", to: "#010203" },
    ]);
    expect(result.replacements).toBe(4);
    expect(result.svg).toContain('stop-color="#abcdef"');
    expect(result.svg).toContain("stop-color:#010203");
    expect(result.svg).toContain("fill:#010203");
  });
});
