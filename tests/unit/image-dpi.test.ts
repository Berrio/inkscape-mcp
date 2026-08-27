import { describe, expect, it } from "vitest";

import { inspectSvgImageDpi } from "../../src/documents/index.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==";

describe("effective image DPI inspection", () => {
  it("reports independent axis DPI for an axis-aligned image", () => {
    const inspected = inspectSvgImageDpi(
      `<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="25.4mm" viewBox="0 0 10 10"><image id="photo" width="10" height="10" href="data:image/png;base64,${png}"/></svg>`,
    );
    expect(inspected.images[0]).toMatchObject({
      dpiX: 1,
      dpiY: 1,
      fidelity: "exact-axis-aligned",
    });
  });

  it("reports a conservative range after rotation or skew", () => {
    const inspected = inspectSvgImageDpi(
      `<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="25.4mm" viewBox="0 0 10 10"><image id="photo" width="10" height="10" transform="rotate(30)" href="data:image/png;base64,${png}"/></svg>`,
    );
    expect(inspected.images[0]?.fidelity).toBe("range-from-transform");
    expect(inspected.images[0]?.dpiRange?.min).toBeGreaterThan(0);
  });
});
