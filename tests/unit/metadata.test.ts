import { describe, expect, it } from "vitest";

import {
  updateSvgDocumentMetadata,
  updateSvgElementAccessibility,
} from "../../src/documents/index.js";

describe("SVG metadata and accessibility", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="hero" width="2" height="1"/></svg>';

  it("writes title, description, license and element names as text only", () => {
    const documented = updateSvgDocumentMetadata(source, {
      description: "A short description",
      license: "MIT",
      title: "Poster",
    });
    expect(documented).toContain("<title>Poster</title>");
    expect(documented).toContain("<desc>A short description</desc>");
    expect(documented).toContain("<metadata><license>MIT</license></metadata>");
    const accessible = updateSvgElementAccessibility(documented, [
      {
        description: "Primary image",
        id: "hero",
        label: "Poster art",
        title: "Poster",
      },
    ]);
    expect(accessible).toContain('aria-label="Poster art"');
    expect(accessible).toContain(
      "<title>Poster</title><desc>Primary image</desc>",
    );
  });

  it("rejects empty or control-character text and unknown IDs", () => {
    expect(() => updateSvgDocumentMetadata(source, { title: "" })).toThrow(
      "invalid",
    );
    expect(() =>
      updateSvgElementAccessibility(source, [{ id: "missing", label: "Name" }]),
    ).toThrow("does not exist");
  });
});
