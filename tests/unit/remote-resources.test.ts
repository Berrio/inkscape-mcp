import { describe, expect, it } from "vitest";

import { inspectSvgRemoteResources } from "../../src/documents/index.js";

describe("remote SVG resource diagnostics", () => {
  it("reports remote references without fetching them", () => {
    expect(
      inspectSvgRemoteResources(
        '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" href="https://example.test/p.png"/><style>.x { fill: url(//example.test/p.svg); }</style></svg>',
      ),
    ).toEqual([
      { attribute: "href", element: "image", id: "photo", scheme: "https" },
      { attribute: "style", element: "style", scheme: "protocol-relative" },
    ]);
  });
});
