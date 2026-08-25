import { describe, expect, it } from "vitest";

import { sanitizeSvg, SvgSecurityError } from "../../src/svg/index.js";

const limits = { maxElements: 20, maxInputBytes: 16_384 };
describe("safe SVG", () => {
  it("preserves namespaces, defs and comments while removing executable content", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><!--note--><defs><linearGradient id="g"/></defs><rect fill="url(#g)" onclick="bad()"/><script>bad()</script><image href="https://bad.example/a.png"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.svg).toContain("linearGradient");
    expect(result.svg).toContain("<!--note-->");
    expect(result.svg).not.toContain("script");
    expect(result.svg).not.toContain("onclick");
    expect(result.removed).toHaveLength(3);
  });
  it("rejects DTD/entity payloads and enforces strict references", () => {
    expect(() =>
      sanitizeSvg("<!DOCTYPE svg><svg/>", { ...limits, mode: "strict" }),
    ).toThrow(SvgSecurityError);
    expect(
      sanitizeSvg(
        '<svg><use href="#local"/><image href="relative.png"/></svg>',
        { ...limits, mode: "strict" },
      ).svg,
    ).not.toContain("relative.png");
  });
  it("does not let a client elevate the configured sanitize ceiling", () => {
    expect(() =>
      sanitizeSvg("<svg><foreignObject/></svg>", {
        ...limits,
        maximumMode: "preserve-local",
        mode: "trusted",
      }),
    ).toThrow("exceeds configured maximum");
  });
});
