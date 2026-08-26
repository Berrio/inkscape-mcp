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
export { preflightSvg, type PreflightIssue } from "./preflight.js";
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
  arrangeSvgShapes,
  groupSvgShapes,
  deleteSvgShapes,
  transformSvgShapes,
  updateSvgShapes,
  type ElementGeometryPatch,
  type ElementArrangeAction,
  type ElementGroupAction,
  type ElementTransform,
  type ElementUpdate,
  type ShapeSpec,
  type ShapeStyle,
} from "./shapes.js";
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
