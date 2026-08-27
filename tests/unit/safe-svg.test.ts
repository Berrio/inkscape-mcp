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
  it("removes forbidden URLs from CSS and SVG paint/reference attributes", () => {
    const source =
      '<svg><defs><linearGradient id="local"/></defs><style>.remote { fill: url(https://bad.example/paint); }</style><rect style="fill:url(#local);filter:URL(https://bad.example/filter)" filter="url(https://bad.example/filter)" fill="url(#local)"/><image src="//bad.example/image.png"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.svg).not.toContain("bad.example");
    expect(result.svg).not.toContain("<style");
    expect(result.svg).toContain('fill="url(#local)"');
    expect(result.removed).toContain("element:style");
    expect(result.removed).toContain("reference:filter");
    expect(result.removed).toContain("reference:src");
  });
  it("preserves metadata, comments, namespaces and local references", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><!--keep--><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Label</dc:title></metadata><defs><path id="shape"/></defs><use href="#shape" inkscape:label="Clone"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.removed).toEqual([]);
    expect(result.svg).toContain("<!--keep-->");
    expect(result.svg).toContain("<metadata>");
    expect(result.svg).toContain('href="#shape"');
    expect(result.svg).toContain("inkscape:label");
  });
  it("allows only declared raster Base64 data URIs in preserve-local mode", () => {
    const source =
      '<svg><image href="data:image/png;base64,AA=="/><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.svg).toContain("data:image/png;base64,AA==");
    expect(result.svg).not.toContain("data:image/svg+xml");
    expect(result.removed).toContain("reference:href");
    expect(
      sanitizeSvg('<svg><image href="data:image/png;base64,AA=="/></svg>', {
        ...limits,
        mode: "strict",
      }).svg,
    ).not.toContain("data:image/png");
  });
  it("preserves unknown local SVG filters while still rejecting external filter URLs", () => {
    const source =
      '<svg><defs><filter id="vendor_effect"><feTurbulence baseFrequency="0.2"/><feDisplacementMap scale="3"/></filter></defs><rect filter="url(#vendor_effect)"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.removed).toEqual([]);
    expect(result.svg).toContain('filter id="vendor_effect"');
    expect(result.svg).toContain('filter="url(#vendor_effect)"');
  });
});
