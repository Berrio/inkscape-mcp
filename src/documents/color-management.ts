import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type SvgColorManagementInspection = {
  iccReferenceCount: number;
  limitations: readonly ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"];
  profiles: readonly {
    id?: string | undefined;
    name?: string | undefined;
    renderingIntent?: string | undefined;
  }[];
};

/** Inspects local SVG color-profile metadata without attempting color conversion. */
export function inspectSvgColorManagement(
  source: string,
): SvgColorManagementInspection {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before inspecting color management");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const elements = Array.from(document.getElementsByTagName("*"));
  return {
    iccReferenceCount: elements.reduce(
      (count, element) =>
        count +
        Array.from(element.attributes).filter((attribute) =>
          /icc-color\s*\(/iu.test(attribute.value),
        ).length,
      0,
    ),
    limitations: ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"],
    profiles: elements
      .filter((element) => element.localName === "color-profile")
      .map((element) => ({
        ...(element.getAttribute("id") === null
          ? {}
          : { id: element.getAttribute("id")! }),
        ...(element.getAttribute("name") === null
          ? {}
          : { name: element.getAttribute("name")! }),
        ...(element.getAttribute("rendering-intent") === null
          ? {}
          : { renderingIntent: element.getAttribute("rendering-intent")! }),
      })),
  };
}
