export { verifyPng, type PngMetadata } from "./png.js";
export {
  comparePngVisual,
  decodePngRgba,
  type DecodedPng,
  type PngVisualDifference,
} from "./png-visual.js";
export { verifyPdf, type PdfMetadata } from "./pdf.js";
export { verifySvg, type SvgMetadata } from "./svg.js";
export {
  buildExportArgv,
  PDF_OPTION_CAPABILITY_FLAGS,
  PNG_OPTION_CAPABILITY_FLAGS,
  requiredPdfCapabilityFlags,
  requiredPngCapabilityFlags,
  type ExportArgvRequest,
} from "./argv.js";
export {
  normalizeExportArea,
  type ExportAreaRequest,
  type ExportDocumentArea,
  type ExportDrawingArea,
  type ExportPageArea,
  type ExportPageRectangle,
  type ExportSelectionArea,
  type NormalizedExportArea,
} from "./area.js";
export {
  beginExportExecution,
  ExportAbortedError,
  type ExportExecutionOptions,
  type ExportProgress,
  type ExportProgressStage,
} from "./execution.js";
export { createExportManifest, type ExportManifest } from "./manifest.js";
export { runExportPipeline, type ExportPipeline } from "./pipeline.js";
export {
  exportPresetSchema,
  exportSpecSchema,
  parseExportSpec,
  type ExportArea,
  type ExportInput,
  type ExportPreset,
  type ExportSpec,
  type MultiOutputTarget,
  type OutputTarget,
} from "./spec.js";
export { expandExportPreset } from "./presets.js";
export { verifyExportArtifact, type ExportVerification } from "./verify.js";
export {
  inspectEmf,
  preflightEmfExport,
  type EmfFlattenPolicy,
  type EmfMetadata,
  type EmfPreflight,
} from "./emf.js";
export {
  inspectLegacyVectorEffects,
  preflightPostscriptExport,
  type PostscriptPreflight,
  type PostscriptRasterizationPolicy,
} from "./postscript.js";
export { pruneSvgPagesForPdf } from "./pdf-pages.js";
export {
  planExportBatch,
  executeExportBatch,
  type ExportBatchResult,
  type ExportBatchMode,
  type PlannedExportVariant,
} from "./batch.js";
export {
  createExportBatchManifest,
  type ExportBatchManifest,
} from "./batch-manifest.js";
