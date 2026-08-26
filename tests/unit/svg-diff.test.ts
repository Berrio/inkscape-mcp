import { describe, expect, it } from "vitest";

import { summarizeSvgDiff } from "../../src/svg/index.js";

describe("SVG semantic diff", () => {
  it("reports deterministic ID and element-count changes without source content", () => {
    expect(
      summarizeSvgDiff(
        '<svg><rect id="stable" width="1"/><circle id="removed"/></svg>',
        '<svg><rect id="stable" width="2"/><path id="added"/></svg>',
      ),
    ).toEqual({
      addedIds: ["added"],
      afterElementCount: 3,
      ambiguousIds: [],
      beforeElementCount: 3,
      changedIds: ["stable"],
      removedIds: ["removed"],
    });
  });

  it("does not claim a diff for duplicate IDs", () => {
    expect(
      summarizeSvgDiff(
        '<svg><rect id="same"/><circle id="same"/></svg>',
        '<svg><rect id="same" width="2"/><circle id="same"/></svg>',
      ),
    ).toMatchObject({ ambiguousIds: ["same"], changedIds: [] });
  });
});
