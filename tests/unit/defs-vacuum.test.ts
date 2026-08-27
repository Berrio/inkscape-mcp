import { describe, expect, it } from "vitest";

import {
  planUnusedSvgDefs,
  vacuumUnusedSvgDefs,
} from "../../src/documents/index.js";

describe("unused SVG defs vacuum", () => {
  it("plans and removes only unreferenced resources", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="keep"/><filter id="unused"/><marker id="also_unused"/></defs><rect fill="url(#keep)"/></svg>';
    expect(planUnusedSvgDefs(source)).toEqual({
      candidateIds: ["keep", "unused", "also_unused"],
      removedIds: ["unused", "also_unused"],
    });
    const result = vacuumUnusedSvgDefs(source);
    expect(result.svg).toContain('id="keep"');
    expect(result.svg).not.toContain('id="unused"');
  });

  it("retains indirect dependencies of a referenced definition", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="base"/><linearGradient id="derived" href="#base"/></defs><rect fill="url(#derived)"/></svg>';
    expect(planUnusedSvgDefs(source).removedIds).toEqual([]);
  });
});
