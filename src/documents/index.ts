export {
  createSvgDocument,
  adjustPageMarginsSvg,
  changePageOrientationSvg,
  fitPageToBoundsSvg,
  inspectSvgSettings,
  parseViewportLength,
  resizeContentSvg,
  resizePageOnlySvg,
  type DocumentSettings,
  type DocumentViewportWarning,
  type DocumentSpec,
  type PageMargins,
  type ViewportDimensionSource,
} from "./basic.js";
export {
  preflightSvg,
  type BleedAssessment,
  type BleedSpec,
  type PreflightIssue,
  type PreflightOptions,
  type PreflightProfile,
  type PrintPreflightDetails,
} from "./preflight.js";
export { inspectSvgInventory, type DocumentInventory } from "./inventory.js";
export {
  querySvgElements,
  querySvgElementTargets,
  type ElementQuery,
  type ElementQueryTarget,
  type ElementSummary,
} from "./elements.js";
export {
  createSvgShapes,
  combineSvgPaths,
  breakApartSvgPath,
  reverseSvgPath,
  flattenSvgShapeTransforms,
  duplicateSvgShape,
  reparentSvgShapes,
  arrangeSvgShapes,
  groupSvgShapes,
  deleteSvgShapes,
  transformSvgShapes,
  updateSvgShapes,
  type ElementGeometryPatch,
  type ElementDuplicateRequest,
  type ElementReparentRequest,
  type ElementArrangeAction,
  type ElementArrangeOptions,
  type ElementGroupAction,
  type ElementTransform,
  type ElementUpdate,
  type ShapeSpec,
  type ShapeStyle,
} from "./shapes.js";
export {
  applySvgGradient,
  createSvgGradient,
  deleteSvgGradient,
  updateSvgGradient,
  type GradientSpec,
  type GradientStop,
} from "./gradients.js";
export {
  updateSvgDocumentMetadata,
  updateSvgElementAccessibility,
  type DocumentMetadataPatch,
  type ElementAccessibilityPatch,
} from "./metadata.js";
export { attachSvgTextToPath, detachSvgTextFromPath } from "./text-path.js";
export { cropSvgImage, type SvgImageCrop } from "./image-crop.js";
export {
  applySvgPattern,
  createSvgPattern,
  deleteSvgPattern,
  updateSvgPattern,
  type SvgPatternSpec,
} from "./patterns.js";
export {
  applySvgClipPath,
  applySvgMask,
  createSvgRectClipPath,
  createSvgRectMask,
  deleteSvgClipPath,
  deleteSvgMask,
  releaseSvgClipPath,
  releaseSvgMask,
  type SvgClipPathSpec,
  type SvgMaskSpec,
} from "./clips.js";
export {
  parseSvgPathData,
  reverseLinearSvgPathData,
  serializeSvgPathData,
  splitSvgPathSubpaths,
  type SvgPathSegment,
} from "./path-data.js";
export {
  PAGE_SIZE_PRESETS,
  pageSizeFromPreset,
  type PageSizePreset,
} from "./presets.js";
export {
  inspectDocumentDisplaySettings,
  updateDocumentDisplaySettings,
  type DocumentDisplaySettings,
  type DocumentDisplaySettingsPatch,
} from "./settings.js";
export {
  addSvgPage,
  deleteSvgPage,
  listSvgPages,
  reorderSvgPages,
  updateSvgPage,
  validateSvgPageLayout,
  type NewSvgPage,
  type PageObjectBounds,
  type SvgPage,
  type SvgPageLayoutValidation,
  type SvgPagePatch,
} from "./pages.js";
export { expandPdfMarginsSvg } from "./pdf-export.js";
export { extractSvgSelection } from "./selection-export.js";
export { rewriteStagedAssetReferences } from "./selection-assets.js";
