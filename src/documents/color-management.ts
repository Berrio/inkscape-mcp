import { DOMParser } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type SvgColorManagementInspection = {
  cmykLikeReferenceCount: number;
  iccReferenceCount: number;
  limitations: readonly ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"];
  profiles: readonly {
    id?: string | undefined;
    name?: string | undefined;
    renderingIntent?: string | undefined;
  }[];
  unresolvedProfileNames: readonly string[];
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
  const profiles = elements
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
    }));
  const references = elements.flatMap((element) =>
    Array.from(element.attributes).flatMap((attribute) =>
      parseIccColorReferences(attribute.value),
    ),
  );
  const declaredNames = new Set(
    profiles.flatMap((profile) =>
      profile.name === undefined ? [] : [profile.name],
    ),
  );
  return {
    cmykLikeReferenceCount: references.filter(
      (reference) => reference.componentCount === 4,
    ).length,
    iccReferenceCount: references.length,
    limitations: ["NO_CMYK_CONVERSION", "NO_OUTPUT_INTENT_VALIDATION"],
    profiles,
    unresolvedProfileNames: [
      ...new Set(
        references
          .map((reference) => reference.profileName)
          .filter((name) => !declaredNames.has(name)),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  };
}

function parseIccColorReferences(
  value: string,
): { componentCount: number; profileName: string }[] {
  const matcher =
    /icc-color\s*\(\s*([A-Za-z0-9_.-]{1,128})\s*((?:,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))+?)\s*\)/giu;
  return [...value.matchAll(matcher)].flatMap((match) => {
    const components = match[2]!
      .split(",")
      .slice(1)
      .map((component) => Number(component.trim()));
    if (
      components.length === 0 ||
      components.some((component) => !Number.isFinite(component))
    )
      return [];
    return [{ componentCount: components.length, profileName: match[1]! }];
  });
}
