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
      truncated: false,
    });
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

  it("applies only an explicit local direct-paint mapping", () => {
    const result = applySvgPalette(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#FF0000" stroke="#00ff00" style="fill:#ff0000"/><stop stop-color="#ff0000"/></svg>',
      [{ from: "#ff0000", to: "#112233" }],
    );
    expect(result.replacements).toBe(2);
    expect(result.svg).toContain('fill="#112233"');
    expect(result.svg).toContain('stop-color="#112233"');
    expect(result.svg).toContain('stroke="#00ff00"');
    expect(result.svg).toContain('style="fill:#ff0000"');
    expect(() =>
      applySvgPalette("<svg/>", [
        { from: "#000000", to: "#111111" },
        { from: "#000000", to: "#222222" },
      ]),
    ).toThrow("duplicate");
  });
});
