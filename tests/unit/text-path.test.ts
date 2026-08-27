import { describe, expect, it } from "vitest";
import {
  attachSvgTextToPath,
  detachSvgTextFromPath,
} from "../../src/documents/index.js";

describe("SVG text paths", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><path id="curve" d="M 0 0 L 10 0"/><text id="label" x="1" y="2">Hello<tspan dx="1">!</tspan></text></svg>';
  it("attaches and detaches text while retaining tspans", () => {
    const attached = attachSvgTextToPath(source, "label", "curve", 2);
    expect(attached).toContain(
      '<textPath href="#curve" startOffset="2">Hello<tspan dx="1">!</tspan></textPath>',
    );
    expect(detachSvgTextFromPath(attached, "label")).toContain(
      '>Hello<tspan dx="1">!</tspan></text>',
    );
  });
});
