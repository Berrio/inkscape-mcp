import { describe, expect, it } from "vitest";

import { listSvgPages, reorderSvgPages } from "../../src/documents/index.js";
import {
  executeExportBatch,
  parseExportSpec,
  planExportBatch,
} from "../../src/export/index.js";
import { sanitizeSvg } from "../../src/svg/index.js";
import { CanonicalPathLocks } from "../../src/storage/index.js";

const revision = "a".repeat(64);

function png(path: string, dpi = 300) {
  return parseExportSpec({
    area: { kind: "drawing" },
    background: { mode: "transparent" },
    format: "png",
    size: { dpi, mode: "dpi" },
    source: { expectedRevision: revision, path: "source.svg" },
    target: { kind: "file", overwrite: false, path },
  });
}

function pagesSvg(count: number): string {
  const pages = Array.from(
    { length: count },
    (_, index) =>
      `<inkscape:page id="page_${index}" x="${index * 10}" y="0" width="10" height="10"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><sodipodi:namedview>${pages}</sodipodi:namedview></svg>`;
}

describe("stress limits", () => {
  it("handles a large bounded SVG and rejects one element beyond its cap", () => {
    const elements = Array.from(
      { length: 10_000 },
      (_, index) => `<rect id="item_${index}"/>`,
    ).join("");
    const source = `<svg xmlns="http://www.w3.org/2000/svg">${elements}</svg>`;
    expect(
      sanitizeSvg(source, {
        maxElements: 10_001,
        maxInputBytes: 2 * 1024 * 1024,
        mode: "strict",
      }).removed,
    ).toEqual([]);
    expect(() =>
      sanitizeSvg(`${source.slice(0, -6)}<rect/></svg>`, {
        maxElements: 10_001,
        maxInputBytes: 2 * 1024 * 1024,
        mode: "strict",
      }),
    ).toThrow("element limit");
  });

  it("preserves deterministic order while reading and reordering 128 pages", () => {
    const source = pagesSvg(128);
    const initial = listSvgPages(source);
    expect(initial).toHaveLength(128);
    const order = initial.map((page) => page.id).reverse();
    expect(
      listSvgPages(reorderSvgPages(source, order)).map((page) => page.id),
    ).toEqual(order);
  });

  it("enforces DPI and batch bounds while executing fifty variants serially", async () => {
    expect(png("dpi-min.png", 0.1).size).toEqual({ dpi: 0.1, mode: "dpi" });
    expect(png("dpi-max.png", 10_000).size).toEqual({
      dpi: 10_000,
      mode: "dpi",
    });
    expect(() => png("dpi-over.png", 10_000.1)).toThrow();
    const variants = planExportBatch(
      Array.from({ length: 50 }, (_, index) => png(`out/${index}.png`)),
    );
    let active = 0;
    let maximumActive = 0;
    const result = await executeExportBatch({
      execute: async (variant) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return variant.outputPath;
      },
      mode: "all_or_nothing",
      variants,
    });
    expect(result.failures).toEqual([]);
    expect(result.successes).toHaveLength(50);
    expect(maximumActive).toBe(1);
    expect(() =>
      planExportBatch(
        Array.from({ length: 51 }, (_, index) => png(`out/${index}.png`)),
      ),
    ).toThrow("between 1 and 50");
  });

  it("serializes high contention on a canonical destination", async () => {
    const locks = new CanonicalPathLocks();
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        locks.withLocks(["workspace/output.png"], async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          completed.push(index);
          active -= 1;
        }),
      ),
    );
    expect(maximumActive).toBe(1);
    expect(completed).toEqual(Array.from({ length: 64 }, (_, index) => index));
  });
});
