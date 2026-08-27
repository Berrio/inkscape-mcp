import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { importSanitizedSvg } from "../../src/import/svg-import.js";

const options = {
  maxInputBytes: 1_024,
  maximumMode: "preserve-local" as const,
  mode: "preserve-local" as const,
};

describe("safe SVG/SVGZ import", () => {
  it("sanitizes an SVGZ before publishing it as editable SVG", () => {
    const input = gzipSync(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect id="safe"/></svg>',
    );
    const result = importSanitizedSvg(input, { ...options, format: "svgz" });
    expect(result.format).toBe("svgz");
    expect(result.inputBytes).toBe(input.length);
    expect(result.removed).toContain("element:script");
    expect(result.svg).toContain('id="safe"');
    expect(result.svg).not.toContain("script");
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects non-gzip and decompression expansion beyond the configured limit", () => {
    expect(() =>
      importSanitizedSvg(Buffer.from("<svg/>"), { ...options, format: "svgz" }),
    ).toThrow("gzip");
    expect(() =>
      importSanitizedSvg(gzipSync("x".repeat(2_000)), {
        ...options,
        format: "svgz",
      }),
    ).toThrow("decompressed input exceeds");
  });
});
