import { describe, expect, it } from "vitest";

import {
  configureSvgSecurityPolicy,
  sanitizeSvg,
  SvgSecurityError,
} from "../../src/svg/index.js";

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
  it("classifies XLink references by namespace, not by literal prefix", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink"><g xmlns:a="http://www.w3.org/1999/xlink"><image xl:href="file:///C:/secret.png"/><image a:href="https://bad.example/a.png"/></g><use xl:href="#local"/></svg>';
    for (const mode of ["strict", "preserve-local"] as const) {
      const result = sanitizeSvg(source, { ...limits, mode });
      expect(result.svg).not.toContain("secret.png");
      expect(result.svg).not.toContain("bad.example");
      expect(result.removed).toEqual(
        expect.arrayContaining(["reference:xl:href", "reference:a:href"]),
      );
    }
    expect(
      sanitizeSvg(source, { ...limits, mode: "preserve-local" }).svg,
    ).toContain('xl:href="#local"');
  });
  it("rejects UNC, foreign schemes, xml:base and remote absref fallbacks", () => {
    const source =
      '<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><image href="\\\\attacker\\share\\a.png"/><a href="ftp://bad.example/x"/><g xml:base="file:///C:/"/><image href="#x" sodipodi:absref="\\\\attacker\\share\\b.png"/><image href="local.png" sodipodi:absref="C:\\work\\local.png"/></svg>';
    const result = sanitizeSvg(source, { ...limits, mode: "preserve-local" });
    expect(result.svg).not.toContain("attacker");
    expect(result.svg).not.toContain("ftp:");
    expect(result.svg).not.toContain("xml:base");
    expect(result.svg).toContain("C:\\work\\local.png");
    expect(
      sanitizeSvg(source, { ...limits, mode: "strict" }).svg,
    ).not.toContain("absref");
  });
  it("removes processing instructions but keeps the XML declaration", () => {
    const result = sanitizeSvg(
      '<?xml version="1.0"?><?xml-stylesheet href="https://bad.example/x.css"?><svg><?custom data?></svg>',
      { ...limits, mode: "preserve-local" },
    );
    expect(result.svg).toContain('<?xml version="1.0"?>');
    expect(result.svg).not.toContain("xml-stylesheet");
    expect(result.svg).not.toContain("custom");
    expect(result.removed).toEqual([
      "instruction:xml-stylesheet",
      "instruction:custom",
    ]);
  });
  it("detects CSS references hidden behind escapes", () => {
    const result = sanitizeSvg(
      '<svg><rect style="fill:u\\72l(https://bad.example/p.svg#g)"/><style>.x{fill:\\75 rl(#local)}</style></svg>',
      { ...limits, mode: "preserve-local" },
    );
    expect(result.svg).not.toContain("bad.example");
    expect(result.removed).toEqual(
      expect.arrayContaining(["reference:style", "element:style"]),
    );
    const escapedSelector = sanitizeSvg(
      "<svg><style>#legacy\\:id, .x { fill: url(#legacy:id) }</style></svg>",
      { ...limits, mode: "preserve-local" },
    );
    expect(escapedSelector.removed).toEqual([]);
  });
  it("removes SMIL animations that assign forbidden references", () => {
    const result = sanitizeSvg(
      '<svg><a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="#a;https://bad.example/x"/><animate attributeName="fill" values="url(https://bad.example/p)"/><animate attributeName="opacity" values="0;1"/></a></svg>',
      { ...limits, mode: "preserve-local" },
    );
    expect(result.svg).not.toContain("javascript");
    expect(result.svg).not.toContain("bad.example");
    expect(result.svg).toContain('attributeName="opacity"');
    expect(result.removed).toEqual([
      "element:set",
      "element:animate",
      "element:animate",
    ]);
  });
  it("applies the startup policy ceiling and size limit to fixed-mode callers", () => {
    try {
      configureSvgSecurityPolicy({ maxInputBytes: 64, maximumMode: "strict" });
      const result = sanitizeSvg('<svg><image href="local.png"/></svg>', {
        ...limits,
        mode: "preserve-local",
      });
      expect(result.removed).toEqual(["reference:href"]);
      expect(() =>
        sanitizeSvg(`<svg>${" ".repeat(64)}</svg>`, {
          ...limits,
          mode: "strict",
        }),
      ).toThrow("input size limit");
      expect(() => configureSvgSecurityPolicy({ maxInputBytes: 0 })).toThrow();
    } finally {
      configureSvgSecurityPolicy({});
    }
  });
});
