import {
  DOMParser,
  XMLSerializer,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";
const MAX_EFFECTS = 1_000;
const MAX_EFFECT_USERS = 1_000;
const MAX_EFFECT_TYPE_LENGTH = 128;

export function inspectSvgPathEffects(source: string): {
  effects: readonly { id: string; type: string; usedBy: readonly string[] }[];
} {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before inspecting path effects");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const all = Array.from(document.getElementsByTagName("*"));
  const effects: { id: string; type: string; usedBy: readonly string[] }[] = [];
  for (const effect of all.filter(
    (element) => element.localName === "path-effect",
  )) {
    const id = effect.getAttribute("id");
    if (!id || !SAFE_ID.test(id)) continue;
    if (effects.length >= MAX_EFFECTS)
      throw new Error("Path effect inventory exceeds the supported limit");
    const usedBy = all
      .filter((element) => pathEffectReferences(element).includes(id))
      .map((element) => element.getAttribute("id"))
      .filter(
        (candidate): candidate is string =>
          candidate !== null && SAFE_ID.test(candidate),
      );
    if (usedBy.length > MAX_EFFECT_USERS)
      throw new Error("Path effect user inventory exceeds the supported limit");
    effects.push({
      id,
      type: safeEffectType(effect.getAttribute("effect")),
      usedBy,
    });
  }
  return { effects };
}

export function manageSvgPathEffect(
  source: string,
  request:
    | { action: "delete"; effectId: string }
    | { action: "detach"; effectId: string; pathIds: readonly string[] },
): { changedPathIds: readonly string[]; svg: string } {
  assertSafePathEffectsSource(source);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const all = Array.from(document.getElementsByTagName("*"));
  const effect = all.find(
    (element) =>
      element.localName === "path-effect" &&
      element.getAttribute("id") === request.effectId,
  );
  if (!effect) throw new Error("Path effect ID does not exist");
  if (request.action === "delete") {
    if (pathEffectUsers(all, request.effectId).length > 0)
      throw new Error("Detach all local paths before deleting a path effect");
    effect.parentNode?.removeChild(effect);
    return {
      changedPathIds: [],
      svg: new XMLSerializer().serializeToString(document),
    };
  }
  if (new Set(request.pathIds).size !== request.pathIds.length)
    throw new Error("Path effect detach IDs must be unique");
  const changedPathIds: string[] = [];
  for (const id of request.pathIds) {
    if (!SAFE_ID.test(id)) throw new Error("Path effect path ID is invalid");
    const path = all.find(
      (element) =>
        element.localName === "path" && element.getAttribute("id") === id,
    );
    if (!path) throw new Error("Path effect detach path ID does not exist");
    const references = pathEffectReferences(path);
    const remaining = references.filter(
      (reference) => reference !== request.effectId,
    );
    if (remaining.length === references.length)
      throw new Error("Path does not reference the requested path effect");
    if (remaining.length === 0)
      path.removeAttributeNS(INKSCAPE_NAMESPACE, "path-effect");
    else
      path.setAttributeNS(
        INKSCAPE_NAMESPACE,
        "inkscape:path-effect",
        remaining.map((item) => `#${item}`).join(";"),
      );
    changedPathIds.push(id);
  }
  return {
    changedPathIds,
    svg: new XMLSerializer().serializeToString(document),
  };
}

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

function assertSafePathEffectsSource(source: string): void {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("SVG must be sanitized before managing path effects");
}

function pathEffectUsers(
  all: readonly XmlElement[],
  effectId: string,
): XmlElement[] {
  return all.filter((element) =>
    pathEffectReferences(element).includes(effectId),
  );
}

function pathEffectReferences(element: XmlElement): string[] {
  return (
    element.getAttributeNS(INKSCAPE_NAMESPACE, "path-effect") ??
    element.getAttribute("inkscape:path-effect") ??
    ""
  )
    .split(/[;,\s]+/u)
    .flatMap((reference) => {
      if (!reference.startsWith("#")) return [];
      const id = reference.slice(1);
      return SAFE_ID.test(id) ? [id] : [];
    });
}

function safeEffectType(value: string | null): string {
  if (
    value === null ||
    value.length < 1 ||
    value.length > MAX_EFFECT_TYPE_LENGTH ||
    !/^[A-Za-z0-9_.-]+$/u.test(value)
  )
    return "unknown";
  return value;
}
