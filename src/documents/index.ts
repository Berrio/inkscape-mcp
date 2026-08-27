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
  normalizeFontFamilies,
  preflightSvgFonts,
  type SvgFontPreflight,
} from "./fonts.js";
export {
  planUnusedSvgDefs,
  vacuumUnusedSvgDefs,
  type UnusedDefsPlan,
} from "./defs-vacuum.js";
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
  createSvgConnector,
  retargetSvgConnector,
  routeSvgConnector,
  breakApartSvgPath,
  reverseSvgPath,
  flattenSvgShapeTransforms,
  editSvgPathNode,
  moveSvgPathNode,
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
  inspectSvgMeshGradients,
  updateSvgGradient,
  type GradientSpec,
  type GradientStop,
  type MeshGradientSummary,
} from "./gradients.js";
export {
  updateSvgDocumentMetadata,
  updateSvgElementAccessibility,
  type DocumentMetadataPatch,
  type ElementAccessibilityPatch,
} from "./metadata.js";
export { attachSvgTextToPath, detachSvgTextFromPath } from "./text-path.js";
export {
  inspectSvgColorManagement,
  type SvgColorManagementInspection,
} from "./color-management.js";
export {
  convertSimpleSvgFlowedText,
  inspectSvgFlowedText,
  type FlowedTextInspection,
} from "./flowed-text.js";
export { applySvgPalette, inspectSvgPalette } from "./palette.js";
export { inspectSvgPathEffects } from "./path-effects.js";
export {
  updateSvgText,
  type SvgTextLayout,
  type SvgTextPatch,
  type SvgTextSpan,
} from "./text.js";
export { cropSvgImage, type SvgImageCrop } from "./image-crop.js";
export {
  extractEmbeddedRaster,
  parseEmbeddedRasterDataUri,
  setSvgImageHref,
  type EmbeddedRaster,
} from "./images.js";
export { inspectSvgImageDpi, type SvgImageDpiInspection } from "./image-dpi.js";
export {
  inspectSvgRemoteResources,
  type RemoteSvgResource,
} from "./remote-resources.js";
export {
  inspectSvgAccessibility,
  type SvgAccessibilityInspection,
} from "./accessibility.js";
export {
  applySvgFilter,
  createSvgFilter,
  createSvgBlurFilter,
  createSvgDropShadowFilter,
  deleteSvgFilter,
  releaseSvgFilter,
  updateSvgFilter,
  type SvgBlendFilterSpec,
  type SvgBlurFilterSpec,
  type SvgColorMatrixFilterSpec,
  type SvgDropShadowFilterSpec,
  type SvgFilterSpec,
} from "./filters.js";
export {
  applySvgMarker,
  createSvgMarker,
  deleteSvgMarker,
  updateSvgMarker,
  type SvgMarkerSpec,
} from "./markers.js";
export {
  applySvgPattern,
  createSvgPattern,
  deleteSvgPattern,
  updateSvgPattern,
  type SvgPatternSpec,
} from "./patterns.js";
export {
  createSvgSymbol,
  createSvgUseClone,
  deleteSvgSymbol,
  listSvgSymbols,
  type SvgSymbol,
  type SvgSymbolSpec,
  type SvgUseCloneSpec,
} from "./symbols.js";
export {
  createSvgGrid,
  createSvgGuide,
  deleteSvgGrid,
  deleteSvgGuide,
  inspectSvgGuidesAndGrids,
  updateSvgGrid,
  updateSvgGuide,
  type SvgGrid,
  type SvgGridPatch,
  type SvgGridSpec,
  type SvgGuide,
  type SvgGuidePatch,
  type SvgGuideSpec,
} from "./guides-grids.js";
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
  moveAbsoluteSvgPathNode,
  editAbsoluteLinearSvgPathNode,
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
