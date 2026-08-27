import { describe, expect, it } from "vitest";
import {
  applySvgMarker,
  createSvgMarker,
  deleteSvgMarker,
  updateSvgMarker,
} from "../../src/documents/index.js";
describe("typed SVG markers", () => {
  it("creates, applies, updates and protects an arrow marker", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="line" d="M 0 0 L 10 0"/></svg>';
    const created = createSvgMarker(source, {
      color: "#000000",
      id: "arrow",
      kind: "arrow",
      size: 5,
    });
    expect(created).toContain('marker id="arrow"');
    const applied = applySvgMarker(created, "arrow", ["line"], "end");
    expect(applied).toContain('marker-end="url(#arrow)"');
    expect(() => deleteSvgMarker(applied, "arrow")).toThrow(
      "would break an SVG reference",
    );
    expect(
      updateSvgMarker(applied, {
        color: "#ff0000",
        id: "arrow",
        kind: "dot",
        size: 4,
      }),
    ).toContain("<circle");
  });
});
