export {
  sanitizeSvg,
  SvgSecurityError,
  type SafeSvgOptions,
  type SafeSvgResult,
  type SanitizeMode,
} from "./safe-dom.js";
export {
  normalizeSvgIds,
  remapSvgIdsForNativeQuery,
  rewriteSvgElementReferences,
  type SvgIdNormalization,
  type SvgNativeQueryIdRemap,
  type SvgIdNormalizationOptions,
  type SvgIdRename,
} from "./ids.js";
export { summarizeSvgDiff, type SvgSemanticDiff } from "./diff.js";
