import { describe, expect, it } from "vitest";

import {
  updateSvgDocumentMetadata,
  updateSvgElementAccessibility,
} from "../../src/documents/index.js";
import { sanitizeSvg } from "../../src/svg/index.js";

describe("SVG metadata and accessibility", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="hero" width="2" height="1"/></svg>';

  it("writes title, description, license and bounded RDF metadata as text only", () => {
    const documented = updateSvgDocumentMetadata(source, {
      creator: "Ana Diseñadora",
      description: "A short description",
      keywords: ["cartel", "verano"],
      license: "MIT",
      title: "Poster",
    });
    expect(documented).toContain("<title>Poster</title>");
    expect(documented).toContain("<desc>A short description</desc>");
    expect(documented).toContain("<license>MIT</license>");
    expect(documented).toContain("<rdf:RDF");
    expect(documented).toContain('<rdf:Description rdf:about="">');
    expect(documented).toContain(">Ana Diseñadora</dc:creator>");
    expect(documented).toContain(">MIT</dc:rights>");
    expect(documented).toContain(
      "><rdf:Bag><rdf:li>cartel</rdf:li><rdf:li>verano</rdf:li></rdf:Bag></dc:subject>",
    );
    expect(
      sanitizeSvg(documented, {
        maxElements: 100,
        maxInputBytes: 16_384,
        mode: "preserve-local",
      }).removed,
    ).toEqual([]);
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
    expect(() =>
      updateSvgDocumentMetadata(source, {
        keywords: ["same", "same"],
      }),
    ).toThrow("unique");
  });
});
