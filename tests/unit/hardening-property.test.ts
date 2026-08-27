import { describe, expect, it } from "vitest";

import {
  parseSvgPathData,
  querySvgElements,
  serializeSvgPathData,
} from "../../src/documents/index.js";
import { exportSpecSchema } from "../../src/export/index.js";
import {
  convertPhysical,
  toCssPixels,
  toMillimeters,
  type PhysicalUnit,
} from "../../src/geometry/index.js";
import { sanitizeSvg } from "../../src/svg/index.js";
import { assertSafeRelativePath } from "../../src/workspace/index.js";

const revision = "a".repeat(64);
const physicalUnits: readonly PhysicalUnit[] = [
  "cm",
  "in",
  "mm",
  "pc",
  "pt",
  "q",
];

function seededValues(count: number): readonly number[] {
  let state = 0x5eedc0de;
  return Array.from({ length: count }, () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  });
}

function pngSpec(path: string): unknown {
  return {
    area: { kind: "drawing" },
    background: { mode: "transparent" },
    format: "png",
    source: { expectedRevision: revision, path },
    target: { kind: "file", overwrite: false, path: "out/label.png" },
  };
}

describe("hardening properties", () => {
  it("keeps finite positive measurements stable across supported units", () => {
    for (const random of seededValues(80)) {
      const value = 0.0001 + random * 10_000;
      const unit = physicalUnits[Math.floor(random * physicalUnits.length)]!;
      const millimeters = toMillimeters({ unit, value });
      expect(toCssPixels({ unit, value }) * (25.4 / 96)).toBeCloseTo(
        millimeters,
        9,
      );
      for (const target of physicalUnits) {
        expect(
          convertPhysical(convertPhysical({ unit, value }, target), unit).value,
        ).toBeCloseTo(value, 9);
      }
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(() => toMillimeters({ unit: "mm", value })).toThrow(
        "finite and positive",
      );
    }
  });

  it("rejects traversal, absolute and malformed workspace/export paths", () => {
    const unsafe = [
      "../label.svg",
      "folder/../../label.svg",
      "/absolute.svg",
      "C:\\absolute.svg",
      "\\\\server\\share\\label.svg",
      "folder//label.svg",
      "folder/./label.svg",
      "folder/label:bad.svg",
      "folder/label\u0000.svg",
    ];
    for (const path of unsafe) {
      expect(() => assertSafeRelativePath(path)).toThrow();
      expect(exportSpecSchema.safeParse(pngSpec(path)).success).toBe(false);
      expect(
        exportSpecSchema.safeParse({
          ...pngSpec("labels/source.svg"),
          target: { kind: "file", overwrite: false, path },
        }).success,
      ).toBe(false);
    }
    for (const random of seededValues(60)) {
      const path = `labels/set-${Math.floor(random * 1_000_000)}/label.svg`;
      expect(() => assertSafeRelativePath(path)).not.toThrow();
      expect(exportSpecSchema.safeParse(pngSpec(path)).success).toBe(true);
    }
  });

  it("round-trips generated linear path data and rejects invalid syntax", () => {
    for (const random of seededValues(60)) {
      const coordinate = Math.round((random - 0.5) * 20_000) / 100;
      const source = `M ${coordinate} ${-coordinate} L ${coordinate + 1} ${coordinate + 2} L ${coordinate + 3} ${coordinate - 4}`;
      const parsed = parseSvgPathData(source);
      expect(parseSvgPathData(serializeSvgPathData(parsed))).toEqual(parsed);
    }
    for (const invalid of [
      "L 0 0",
      "M 0",
      "M 0 0 R 1 2",
      "M 0 0 A 1 1 0 2 0 1 1",
      "M 0 0 L Infinity 1",
    ]) {
      expect(() => parseSvgPathData(invalid)).toThrow();
    }
  });

  it("accepts only bounded compound selectors", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="safe" class="label primary"/></svg>';
    for (const selector of ["rect.primary", "#safe", "rect.label.primary"]) {
      expect(
        querySvgElements(svg, { limit: 10, offset: 0, selector }).total,
      ).toBe(1);
    }
    for (const selector of [
      "rect .primary",
      "rect, .primary",
      "rect:hover",
      "*",
      "rect".repeat(100),
    ]) {
      expect(() =>
        querySvgElements(svg, { limit: 10, offset: 0, selector }),
      ).toThrow();
    }
  });

  it("removes generated external SVG references and event attributes", () => {
    for (const random of seededValues(50)) {
      const host = `attacker-${Math.floor(random * 1_000_000)}.invalid`;
      for (const protocol of ["http", "https", "file", "javascript"]) {
        const source = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${protocol}://${host}/asset.png" onload="steal()"/><rect style="fill:url(${protocol}://${host}/paint)"/></svg>`;
        const result = sanitizeSvg(source, {
          maxElements: 10,
          maxInputBytes: 10_000,
          mode: "preserve-local",
        });
        expect(result.svg).not.toContain(host);
        expect(result.svg).not.toMatch(/\sonload=/u);
      }
    }
  });
});
