import { describe, expect, it } from "vitest";

import { inspectSvgPalette } from "../../src/documents/index.js";

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
      truncated: false,
    });
  });
});
