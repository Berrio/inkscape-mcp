import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import { mkdir, readFile, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { CapabilityService } from "../capabilities/index.js";
import { assertDocumentWorkspace, type ServerConfig } from "../config/index.js";
import {
  addSvgPage,
  adjustPageMarginsSvg,
  changePageOrientationSvg,
  createSvgDocument,
  applySvgFilter,
  cropSvgImage,
  applySvgClipPath,
  applySvgMask,
  createSvgRectClipPath,
  createSvgRectMask,
  createSvgFilter,
  vacuumUnusedSvgDefs,
  deleteSvgClipPath,
  deleteSvgFilter,
  deleteSvgMask,
  createSvgShapes,
  attachSvgTextToPath,
  detachSvgTextFromPath,
  updateSvgDocumentMetadata,
  updateSvgElementAccessibility,
  applySvgGradient,
  createSvgGradient,
  deleteSvgGradient,
  combineSvgPaths,
  breakApartSvgPath,
  flattenSvgShapeTransforms,
  arrangeSvgShapes,
  groupSvgShapes,
  deleteSvgShapes,
  duplicateSvgShape,
  transformSvgShapes,
  updateSvgShapes,
  deleteSvgPage,
  expandPdfMarginsSvg,
  extractSvgSelection,
  fitPageToBoundsSvg,
  inspectDocumentDisplaySettings,
  inspectSvgInventory,
  normalizeFontFamilies,
  inspectSvgSettings,
  listSvgPages,
  pageSizeFromPreset,
  parseViewportLength,
  preflightSvg,
  preflightSvgFonts,
  querySvgElementTargets,
  reorderSvgPages,
  reparentSvgShapes,
  reverseSvgPath,
  updateSvgGradient,
  applySvgPattern,
  createSvgPattern,
  deleteSvgPattern,
  updateSvgPattern,
  applySvgMarker,
  createSvgMarker,
  deleteSvgMarker,
  updateSvgMarker,
  updateSvgFilter,
  updateSvgText,
  resizeContentSvg,
  resizePageOnlySvg,
  releaseSvgClipPath,
  releaseSvgMask,
  releaseSvgFilter,
  rewriteStagedAssetReferences,
  updateSvgPage,
  updateDocumentDisplaySettings,
  validateSvgPageLayout,
  planUnusedSvgDefs,
  type ShapeSpec,
} from "../documents/index.js";
import {
  nativeVisualBoundsDescriptor,
  planAlignment,
  planDistribution,
  unionLayoutBounds,
  type LayoutBounds,
  type LayoutMove,
  type LayoutReference,
} from "../geometry/index.js";
import {
  normalizeSvgIds,
  remapSvgIdsForNativeQuery,
  sanitizeSvg,
  summarizeSvgDiff,
} from "../svg/index.js";
import { runDoctor } from "../doctor/index.js";
import { locateInkscape, probeInkscapeCandidate } from "../discovery/index.js";
import {
  buildExportArgv,
  createExportBatchManifest,
  executeExportBatch,
  expandExportPreset,
  type ExportSpec,
  exportPresetSchema,
  exportSpecSchema,
  normalizeExportArea,
  parseExportSpec,
  planExportBatch,
  pruneSvgPagesForPdf,
  requiredPdfCapabilityFlags,
  requiredPngCapabilityFlags,
  verifyPdf,
  verifyExportArtifact,
  verifyPng,
  verifySvg,
} from "../export/index.js";
import {
  parseInkscapeQueryAll,
  type InkscapeBounds,
} from "../inkscape/index.js";
import { ProcessRunner } from "../runner/index.js";
import { PreviewCache } from "../preview/index.js";
import { JobStore } from "./jobs.js";
import {
  AtomicFileStore,
  ArtifactStore,
  createNativeInputBundle,
  ScratchManager,
  sha256File,
  SnapshotStore,
} from "../storage/index.js";
import {
  WorkspaceService,
  type ResolvedWorkspacePath,
} from "../workspace/index.js";

const statusSchema = z.object({
  actionCount: z.number().int().nonnegative(),
  capabilitiesReady: z.boolean(),
  diagnosticsCount: z.number().int().nonnegative(),
  inkscape: z
    .object({
      installKind: z.string(),
      version: z.string(),
    })
    .optional(),
  securityPosture: z.object({
    externalResources: z.literal("deny"),
    nativeInputPolicy: z.literal("trusted-local-only"),
    overwriteDefault: z.literal(false),
    pathsRedacted: z.literal(true),
    workspaceReady: z.boolean(),
  }),
  workspaceReady: z.boolean(),
});
const artifactSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  id: z.string().regex(/^art_[a-f0-9]{32}$/u),
  size: z.number().int().nonnegative(),
  uri: z.string().regex(/^inkscape:\/\/artifact\/art_[a-f0-9]{32}$/u),
});
const pageSchema = z.object({
  height: z.number().finite().positive(),
  id: z.string().regex(/^page_[A-Za-z0-9_-]{1,120}$/u),
  label: z.string().min(1).max(256).optional(),
  width: z.number().finite().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
});
const viewportLengthSchema = z.object({
  unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
  value: z.number().finite().positive(),
});
const physicalLengthSchema = z.object({
  unit: z.enum(["mm", "cm", "in", "pt", "pc", "q"]),
  value: z.number().finite().nonnegative(),
});
const pdfMarginSchema = z
  .object({
    bottom: physicalLengthSchema,
    left: physicalLengthSchema,
    right: physicalLengthSchema,
    top: physicalLengthSchema,
  })
  .strict();
const bleedSpecSchema = z
  .object({
    behavior: z.enum(["metadata-only", "expand-temporary-page"]),
    bottom: physicalLengthSchema,
    left: physicalLengthSchema,
    right: physicalLengthSchema,
    top: physicalLengthSchema,
  })
  .strict();
const edgeMillimetersSchema = z.object({
  bottom: z.number().finite().nonnegative(),
  left: z.number().finite().nonnegative(),
  right: z.number().finite().nonnegative(),
  top: z.number().finite().nonnegative(),
});
const printPreflightSchema = z.object({
  bleed: z
    .object({
      behavior: z.enum(["metadata-only", "expand-temporary-page"]),
      missingMm: edgeMillimetersSchema,
      presentMm: edgeMillimetersSchema,
      requiredMm: edgeMillimetersSchema,
    })
    .optional(),
  images: z.object({
    lowDpiCount: z.number().int().nonnegative(),
    measuredCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  }),
});
const pageMarginsSchema = z
  .object({
    bottom: z.number().finite().nonnegative().max(100_000),
    left: z.number().finite().nonnegative().max(100_000),
    right: z.number().finite().nonnegative().max(100_000),
    top: z.number().finite().nonnegative().max(100_000),
  })
  .strict();
const displaySettingsSchema = z.object({
  borderColor: z.string().regex(/^#[a-f0-9]{6}$/u),
  borderOpacity: z.number().min(0).max(1),
  deskColor: z.string().regex(/^#[a-f0-9]{6}$/u),
  pageColor: z.string().regex(/^#[a-f0-9]{6}$/u),
  pageOpacity: z.number().min(0).max(1),
});
const inventorySchema = z.object({
  definitions: z.object({
    filters: z.array(
      z.object({
        id: z.string(),
        primitiveCount: z.number().int().nonnegative(),
      }),
    ),
    gradients: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["linear", "radial"]),
        stopCount: z.number().int().nonnegative(),
      }),
    ),
    patterns: z.array(
      z.object({
        height: z.string().optional(),
        id: z.string(),
        width: z.string().optional(),
      }),
    ),
  }),
  duplicateIds: z.array(z.string()),
  elementCount: z.number().int().nonnegative(),
  externalResourceCount: z.number().int().nonnegative(),
  fontFamilies: z.array(z.string()),
  fontWarnings: z.tuple([z.literal("FONT_RESOLUTION_UNAVAILABLE")]),
  fontResolution: z.literal("unavailable"),
  images: z.array(
    z.object({
      display: z.object({
        height: z.string().optional(),
        width: z.string().optional(),
      }),
      intrinsic: z.object({
        height: z.number().int().positive().optional(),
        status: z.enum(["available", "unavailable"]),
        width: z.number().int().positive().optional(),
      }),
      kind: z.enum(["embedded", "external", "linked"]),
    }),
  ),
  ids: z.array(z.string()),
  layers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      locked: z.boolean(),
      visibility: z.enum(["hidden", "visible"]),
    }),
  ),
  namespaces: z.array(z.string()),
  nextOffset: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative(),
  paintUsage: z.object({
    fills: z.number().int().nonnegative(),
    filters: z.number().int().nonnegative(),
    gradients: z.number().int().nonnegative(),
    opacities: z.number().int().nonnegative(),
    patterns: z.number().int().nonnegative(),
    strokes: z.number().int().nonnegative(),
  }),
  totalElementCount: z.number().int().nonnegative(),
  typeCounts: z.record(z.string(), z.number().int().nonnegative()),
  truncated: z.boolean(),
  unknownNamespaces: z.array(z.string()),
  unresolvedReferences: z.array(z.string()),
});
const visualBoundsSchema = z.object({
  fidelity: z.literal("partial"),
  global: z
    .object({
      height: z.number().finite().positive(),
      width: z.number().finite().positive(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .optional(),
  limitations: z.array(z.string()),
  pages: z.array(
    z.object({
      bounds: z
        .object({
          height: z.number().finite().positive(),
          width: z.number().finite().positive(),
          x: z.number().finite(),
          y: z.number().finite(),
        })
        .optional(),
      id: z.string(),
    }),
  ),
  source: z.literal("inkscape-query-all"),
});
const pagePresetSchema = z.enum([
  "a3-landscape",
  "a3-portrait",
  "a4-landscape",
  "a4-portrait",
  "letter-landscape",
  "letter-portrait",
]);
const shapeStyleSchema = z.object({
  classes: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u))
    .min(1)
    .max(32)
    .refine((value) => new Set(value).size === value.length, {
      message: "classes must be unique",
    })
    .optional(),
  display: z.enum(["inline", "none"]).optional(),
  fill: z
    .string()
    .regex(/^(?:none|#[a-fA-F0-9]{6})$/u)
    .optional(),
  fillOpacity: z.number().finite().min(0).max(1).optional(),
  fillRule: z.enum(["nonzero", "evenodd"]).optional(),
  fontFamily: z.string().min(1).max(256).optional(),
  fontSize: z.number().finite().positive().max(10_000).optional(),
  fontStyle: z.enum(["normal", "italic", "oblique"]).optional(),
  fontWeight: z
    .union([
      z.enum(["normal", "bold"]),
      z
        .number()
        .int()
        .min(100)
        .max(900)
        .refine((value) => value % 100 === 0),
    ])
    .optional(),
  letterSpacing: z.number().finite().min(-10_000).max(10_000).optional(),
  locked: z.boolean().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  paintOrder: z
    .enum(["normal", "fill stroke markers", "stroke fill markers"])
    .optional(),
  stroke: z
    .string()
    .regex(/^(?:none|#[a-fA-F0-9]{6})$/u)
    .optional(),
  strokeDasharray: z
    .array(z.number().finite().min(0).max(100_000))
    .max(32)
    .optional(),
  strokeLineCap: z.enum(["butt", "round", "square"]).optional(),
  strokeLineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  strokeMiterLimit: z.number().finite().min(1).max(100_000).optional(),
  strokeOpacity: z.number().finite().min(0).max(1).optional(),
  strokeWidth: z.number().finite().nonnegative().optional(),
  textAnchor: z.enum(["start", "middle", "end"]).optional(),
  visibility: z.enum(["visible", "hidden"]).optional(),
  wordSpacing: z.number().finite().min(-10_000).max(10_000).optional(),
});
const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
const shapeIdSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u);
const textContentSchema = z
  .string()
  .max(10_000)
  .refine((value) => !hasControlCharacters(value), {
    message: "Text cannot contain control characters",
  });
const shapeSchema = z.discriminatedUnion("kind", [
  z.object({
    height: z.number().finite().positive(),
    id: shapeIdSchema.optional(),
    kind: z.literal("rect"),
    parentId: shapeIdSchema.optional(),
    rx: z.number().finite().nonnegative().optional(),
    ry: z.number().finite().nonnegative().optional(),
    style: shapeStyleSchema.optional(),
    width: z.number().finite().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    cx: z.number().finite(),
    cy: z.number().finite(),
    id: shapeIdSchema.optional(),
    kind: z.literal("circle"),
    parentId: shapeIdSchema.optional(),
    r: z.number().finite().positive(),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    cx: z.number().finite(),
    cy: z.number().finite(),
    id: shapeIdSchema.optional(),
    kind: z.literal("spiral"),
    parentId: shapeIdSchema.optional(),
    r: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    style: shapeStyleSchema.optional(),
    turns: z.number().finite().min(0.1).max(100),
  }),
  z.object({
    cx: z.number().finite(),
    cy: z.number().finite(),
    id: shapeIdSchema.optional(),
    kind: z.literal("ellipse"),
    parentId: shapeIdSchema.optional(),
    rx: z.number().finite().positive(),
    ry: z.number().finite().positive(),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    cx: z.number().finite(),
    cy: z.number().finite(),
    id: shapeIdSchema.optional(),
    kind: z.literal("regular_polygon"),
    parentId: shapeIdSchema.optional(),
    points: z.number().int().min(3).max(1_000),
    r: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    cx: z.number().finite(),
    cy: z.number().finite(),
    id: shapeIdSchema.optional(),
    kind: z.literal("star"),
    parentId: shapeIdSchema.optional(),
    points: z.number().int().min(3).max(1_000),
    r1: z.number().finite().positive(),
    r2: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("line"),
    parentId: shapeIdSchema.optional(),
    style: shapeStyleSchema.optional(),
    x1: z.number().finite(),
    x2: z.number().finite(),
    y1: z.number().finite(),
    y2: z.number().finite(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("polygon"),
    parentId: shapeIdSchema.optional(),
    points: z.array(pointSchema).min(2).max(1_000),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("polyline"),
    parentId: shapeIdSchema.optional(),
    points: z.array(pointSchema).min(2).max(1_000),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("path"),
    parentId: shapeIdSchema.optional(),
    d: z.string().min(1).max(100_000),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    assetPath: z.string().min(1).max(1024),
    embedding: z.enum(["embed", "link"]).default("link"),
    height: z.number().finite().positive(),
    id: shapeIdSchema.optional(),
    kind: z.literal("image"),
    parentId: shapeIdSchema.optional(),
    preserveAspectRatio: z
      .enum(["none", "xMidYMid meet", "xMidYMid slice"])
      .optional(),
    style: shapeStyleSchema.optional(),
    width: z.number().finite().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("text"),
    parentId: shapeIdSchema.optional(),
    style: shapeStyleSchema.optional(),
    spans: z
      .array(
        z.object({
          dx: z.number().finite().optional(),
          dy: z.number().finite().optional(),
          text: textContentSchema,
        }),
      )
      .max(100)
      .optional(),
    text: textContentSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("group"),
    parentId: shapeIdSchema.optional(),
    style: shapeStyleSchema.optional(),
  }),
  z.object({
    id: shapeIdSchema.optional(),
    kind: z.literal("layer"),
    label: z.string().min(1).max(256).optional(),
    parentId: shapeIdSchema.optional(),
    style: shapeStyleSchema.optional(),
  }),
]);
type ShapeRequest = z.infer<typeof shapeSchema>;
const transformSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("translate"),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    kind: z.literal("scale"),
    x: z
      .number()
      .finite()
      .refine((value) => value !== 0),
    y: z
      .number()
      .finite()
      .refine((value) => value !== 0)
      .optional(),
  }),
  z.object({
    angle: z.number().finite(),
    cx: z.number().finite().optional(),
    cy: z.number().finite().optional(),
    kind: z.literal("rotate"),
  }),
  z.object({ angle: z.number().finite(), kind: z.literal("skew_x") }),
  z.object({ angle: z.number().finite(), kind: z.literal("skew_y") }),
  z.object({ kind: z.literal("flip_x") }),
  z.object({ kind: z.literal("flip_y") }),
  z.object({
    a: z.number().finite(),
    b: z.number().finite(),
    c: z.number().finite(),
    d: z.number().finite(),
    e: z.number().finite(),
    f: z.number().finite(),
    kind: z.literal("matrix"),
  }),
]);
const gradientStopSchema = z.object({
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
  offset: z.number().finite().min(0).max(1),
  opacity: z.number().finite().min(0).max(1).optional(),
});
const gradientSpecSchema = z
  .object({
    cx: z.number().finite().optional(),
    cy: z.number().finite().optional(),
    fx: z.number().finite().optional(),
    fy: z.number().finite().optional(),
    id: shapeIdSchema,
    kind: z.enum(["linear", "radial"]),
    r: z.number().finite().positive().optional(),
    spread: z.enum(["pad", "reflect", "repeat"]).optional(),
    stops: z.array(gradientStopSchema).min(2).max(64),
    transform: z
      .tuple([
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
      ])
      .optional(),
    units: z.enum(["objectBoundingBox", "userSpaceOnUse"]).optional(),
    x1: z.number().finite().optional(),
    x2: z.number().finite().optional(),
    y1: z.number().finite().optional(),
    y2: z.number().finite().optional(),
  })
  .refine(
    (value) =>
      value.stops.every(
        (stop, index) =>
          index === 0 || stop.offset >= value.stops[index - 1]!.offset,
      ),
    "Gradient stops must be ordered by offset",
  );
const patternSpecSchema = z.object({
  background: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .optional(),
  foreground: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
  id: shapeIdSchema,
  kind: z.enum(["dots", "stripes"]),
  size: z.number().finite().positive().max(1_000_000),
  transform: z
    .tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ])
    .optional(),
  units: z.enum(["objectBoundingBox", "userSpaceOnUse"]).optional(),
  weight: z.number().finite().positive(),
});
const markerSpecSchema = z.object({
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
  id: shapeIdSchema,
  kind: z.enum(["arrow", "dot"]),
  orient: z.enum(["auto", "auto-start-reverse"]).optional(),
  size: z.number().finite().positive().max(1_000),
  units: z.enum(["strokeWidth", "userSpaceOnUse"]).optional(),
});
const filterSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    id: shapeIdSchema,
    kind: z.literal("blur"),
    stdDeviation: z.number().finite().nonnegative(),
  }),
  z.object({
    dx: z.number().finite(),
    dy: z.number().finite(),
    id: shapeIdSchema,
    kind: z.literal("drop_shadow"),
    stdDeviation: z.number().finite().nonnegative(),
  }),
  z.object({
    id: shapeIdSchema,
    input: z.enum(["BackgroundImage", "SourceGraphic"]).optional(),
    kind: z.literal("blend"),
    mode: z.enum([
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
    ]),
  }),
  z.object({
    id: shapeIdSchema,
    kind: z.literal("color_matrix"),
    values: z.array(z.number().finite()).length(20),
  }),
]);
const textLayoutSchema = z.object({
  baseline: z
    .enum(["auto", "alphabetic", "central", "hanging", "middle"])
    .optional(),
  direction: z.enum(["ltr", "rtl"]).optional(),
  letterSpacing: z.number().finite().optional(),
  textAnchor: z.enum(["start", "middle", "end"]).optional(),
  wordSpacing: z.number().finite().optional(),
  writingMode: z
    .enum(["horizontal-tb", "vertical-rl", "vertical-lr"])
    .optional(),
});
const textSpanSchema = z.object({
  dx: z.number().finite().optional(),
  dy: z.number().finite().optional(),
  text: z.string().min(0).max(10_000),
});
const layoutAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("selection") }),
  z.object({ kind: z.literal("page"), pageId: shapeIdSchema.optional() }),
  z.object({ id: shapeIdSchema, kind: z.literal("element") }),
  z.object({
    kind: z.literal("coordinate"),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
]);
const layoutMoveSchema = z.object({
  id: shapeIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
});
const geometryPatchSchema = z.discriminatedUnion("kind", [
  z
    .object({
      height: z.number().finite().positive().optional(),
      kind: z.literal("rect"),
      rx: z.number().finite().nonnegative().optional(),
      ry: z.number().finite().nonnegative().optional(),
      width: z.number().finite().positive().optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .refine(
      (value) =>
        value.height !== undefined ||
        value.rx !== undefined ||
        value.ry !== undefined ||
        value.width !== undefined ||
        value.x !== undefined ||
        value.y !== undefined,
      "Geometry patch requires at least one value",
    ),
  z
    .object({
      cx: z.number().finite().optional(),
      cy: z.number().finite().optional(),
      kind: z.literal("circle"),
      r: z.number().finite().positive().optional(),
    })
    .refine(
      (value) =>
        value.cx !== undefined ||
        value.cy !== undefined ||
        value.r !== undefined,
      "Geometry patch requires at least one value",
    ),
  z
    .object({
      cx: z.number().finite().optional(),
      cy: z.number().finite().optional(),
      kind: z.literal("ellipse"),
      rx: z.number().finite().positive().optional(),
      ry: z.number().finite().positive().optional(),
    })
    .refine(
      (value) =>
        value.cx !== undefined ||
        value.cy !== undefined ||
        value.rx !== undefined ||
        value.ry !== undefined,
      "Geometry patch requires at least one value",
    ),
  z
    .object({
      kind: z.literal("line"),
      x1: z.number().finite().optional(),
      x2: z.number().finite().optional(),
      y1: z.number().finite().optional(),
      y2: z.number().finite().optional(),
    })
    .refine(
      (value) =>
        value.x1 !== undefined ||
        value.x2 !== undefined ||
        value.y1 !== undefined ||
        value.y2 !== undefined,
      "Geometry patch requires at least one value",
    ),
  z
    .object({
      kind: z.literal("polygon"),
      points: z.array(pointSchema).min(2).max(1_000).optional(),
    })
    .refine(
      (value) => value.points !== undefined,
      "Geometry patch requires points",
    ),
  z
    .object({
      kind: z.literal("polyline"),
      points: z.array(pointSchema).min(2).max(1_000).optional(),
    })
    .refine(
      (value) => value.points !== undefined,
      "Geometry patch requires points",
    ),
  z
    .object({
      kind: z.literal("text"),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .refine(
      (value) => value.x !== undefined || value.y !== undefined,
      "Geometry patch requires at least one value",
    ),
]);
const elementUpdateSchema = z
  .object({
    geometry: geometryPatchSchema.optional(),
    id: shapeIdSchema,
    label: z.string().min(1).max(256).optional(),
    style: shapeStyleSchema.optional(),
    text: textContentSchema.optional(),
  })
  .refine(
    (value) =>
      value.geometry !== undefined ||
      value.label !== undefined ||
      value.style !== undefined ||
      value.text !== undefined,
    "Element update requires at least one patch",
  );
const transactionAliasSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const transactionReferenceSchema = z.union([
  shapeIdSchema,
  z.string().regex(/^@[a-z][a-z0-9_-]{0,63}$/u),
]);
const transactionElementUpdateSchema = elementUpdateSchema.safeExtend({
  id: transactionReferenceSchema,
});
const transactionArrangeOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["back", "front", "lower", "raise"]),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
  }),
  z.object({
    action: z.literal("index"),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
    index: z.number().int().min(0).max(100_000),
  }),
  z.object({
    action: z.enum(["before", "after"]),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
    relativeTo: transactionReferenceSchema,
  }),
]);
const transactionGroupOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("group"),
    alias: transactionAliasSchema.optional(),
    groupId: shapeIdSchema,
    ids: z.array(transactionReferenceSchema).min(1).max(100),
  }),
  z.object({
    action: z.literal("ungroup"),
    groupId: transactionReferenceSchema,
  }),
]);
const designOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    elements: z.array(shapeSchema).min(1).max(100),
    aliases: z
      .record(transactionAliasSchema, shapeIdSchema)
      .refine((value) => Object.keys(value).length <= 100, "Too many aliases")
      .optional(),
  }),
  z.object({
    kind: z.literal("update"),
    elements: z.array(transactionElementUpdateSchema).min(1).max(100),
  }),
  z.object({
    kind: z.literal("transform"),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
    transform: transformSchema,
  }),
  z.object({
    kind: z.literal("arrange"),
    request: transactionArrangeOperationSchema,
  }),
  z.object({
    kind: z.literal("group"),
    request: transactionGroupOperationSchema,
  }),
  z.object({
    kind: z.literal("duplicate"),
    alias: transactionAliasSchema.optional(),
    id: transactionReferenceSchema,
    mode: z.enum(["copy", "use"]),
    newId: shapeIdSchema,
    parentId: transactionReferenceSchema.optional(),
  }),
  z.object({
    kind: z.literal("reparent"),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
    parentId: transactionReferenceSchema,
  }),
  z.object({
    kind: z.literal("delete"),
    ids: z.array(transactionReferenceSchema).min(1).max(100),
  }),
]);
type DesignOperation = z.infer<typeof designOperationSchema>;
const semanticDiffSchema = z.object({
  addedIds: z.array(shapeIdSchema),
  afterElementCount: z.number().int().nonnegative(),
  ambiguousIds: z.array(shapeIdSchema),
  beforeElementCount: z.number().int().nonnegative(),
  changedIds: z.array(shapeIdSchema),
  removedIds: z.array(shapeIdSchema),
});
const elementSummarySchema = z.object({
  attributes: z.record(z.string(), z.string()),
  bounds: z
    .object({
      fidelity: z.literal("partial"),
      height: z.number().finite().nonnegative(),
      kind: z.literal("visual"),
      limitations: z.tuple([z.literal("GEOMETRIC_ENGINE_UNAVAILABLE")]),
      source: z.literal("inkscape-query-all"),
      width: z.number().finite().nonnegative(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .optional(),
  computedStyle: z
    .object({
      fidelity: z.enum(["exact-supported", "partial"]),
      limitations: z.array(z.string()),
      properties: z.record(z.string(), z.string()),
    })
    .optional(),
  id: shapeIdSchema.optional(),
  kind: z.string(),
  layerId: shapeIdSchema.optional(),
  parentId: shapeIdSchema.optional(),
});
const nativeVisualBounds = nativeVisualBoundsDescriptor();
const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1_000;
const PREVIEW_MAX_AXIS = 2_048;

function pngCapabilityLabel(flag: string): string {
  const labels: Readonly<Record<string, string>> = {
    "--export-area-snap": "snap area to pixels",
    "--export-png-antialias": "antialias",
    "--export-png-color-mode": "color mode",
    "--export-png-compression": "compression",
    "--export-png-use-dithering": "dithering",
  };
  return labels[flag] ?? "PNG renderer option";
}

function pdfCapabilityLabel(flag: string): string {
  const labels: Readonly<Record<string, string>> = {
    "--export-filter-dpi": "filter DPI",
    "--export-ignore-filters": "ignore filters",
    "--export-latex": "LaTeX sidecar",
    "--export-pdf-version": "PDF version",
    "--export-text-to-path": "text to paths",
  };
  return labels[flag] ?? "PDF renderer option";
}

export function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "inkscape-mcp",
    version: packageMetadata.version,
  });
  const fileStore = new AtomicFileStore();
  const jobs = new JobStore();
  const runner = new ProcessRunner(config.maxConcurrency);
  const capabilities = new CapabilityService();
  const scratch = new ScratchManager(
    config.scratchRoot === "auto" ? undefined : config.scratchRoot,
  );
  const snapshots = new SnapshotStore(
    join(
      config.scratchRoot === "auto" ? tmpdir() : config.scratchRoot,
      "inkscape-mcp-snapshots",
    ),
    fileStore,
  );
  const artifacts = new ArtifactStore(
    join(
      config.scratchRoot === "auto" ? tmpdir() : config.scratchRoot,
      "inkscape-mcp-artifacts",
    ),
    config.maxArtifactBytes,
  );
  const previewCache = new PreviewCache(
    join(
      config.scratchRoot === "auto" ? tmpdir() : config.scratchRoot,
      "inkscape-mcp-preview-cache",
    ),
  );
  const workspaces = () => WorkspaceService.create(config.workspaceRoots);
  let fontCache:
    | { expiresAt: number; families: readonly string[]; source: string }
    | undefined;

  const systemFonts = async (refresh: boolean) => {
    if (!refresh && fontCache !== undefined && fontCache.expiresAt > Date.now())
      return { ...fontCache, cached: true };
    const discovered = await discoverSystemFontFamilies(runner);
    fontCache = {
      expiresAt: Date.now() + 5 * 60_000,
      families: discovered.families,
      source: discovered.source,
    };
    return { ...fontCache, cached: false };
  };

  server.registerResource(
    "artifact",
    new ResourceTemplate("inkscape://artifact/{id}", { list: undefined }),
    {
      description:
        "First bounded immutable chunk of an opaque Inkscape artifact capability.",
      mimeType: "application/octet-stream",
      title: "Inkscape artifact",
    },
    async (uri, variables) =>
      artifactResource(
        artifacts,
        resourceVariable(variables.id),
        0,
        uri.href,
        config.maxResourceReadBytes,
      ),
  );
  server.registerResource(
    "artifact_chunk",
    new ResourceTemplate("inkscape://artifact/{id}/chunk/{offset}", {
      list: undefined,
    }),
    {
      description:
        "A later bounded immutable chunk of an opaque Inkscape artifact capability.",
      mimeType: "application/octet-stream",
      title: "Inkscape artifact chunk",
    },
    async (uri, variables) =>
      artifactResource(
        artifacts,
        resourceVariable(variables.id),
        parseArtifactOffset(resourceVariable(variables.offset)),
        uri.href,
        config.maxResourceReadBytes,
      ),
  );

  server.registerTool(
    "inkscape_status",
    {
      description:
        "Reports local Inkscape availability, observed capabilities and security posture without exposing filesystem paths.",
      inputSchema: z.object({}),
      outputSchema: statusSchema,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const report = await runDoctor(config, process.cwd());
      const output = {
        actionCount: report.capabilities?.actionCount ?? 0,
        capabilitiesReady: report.capabilities !== undefined,
        diagnosticsCount: report.diagnostics.length,
        ...(report.inkscape === undefined
          ? {}
          : {
              inkscape: {
                installKind: report.inkscape.installKind,
                version: report.inkscape.version,
              },
            }),
        securityPosture: {
          externalResources: config.externalResources,
          nativeInputPolicy: config.nativeInputPolicy,
          overwriteDefault: config.overwriteDefault,
          pathsRedacted: true as const,
          workspaceReady: report.workspaceReady,
        },
        workspaceReady: report.workspaceReady,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "fonts_list",
    {
      description:
        "Lists a bounded cache of local system font family names without exposing font file paths.",
      inputSchema: z.object({ refresh: z.boolean().default(false) }),
      outputSchema: z.object({
        cached: z.boolean(),
        familyCount: z.number().int().nonnegative(),
        families: z.array(z.string().min(1).max(256)),
        source: z.enum(["fontconfig", "windows-installed-font-collection"]),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ refresh }) => {
      const fonts = await systemFonts(refresh);
      const output = {
        cached: fonts.cached,
        familyCount: fonts.families.length,
        families: fonts.families,
        source: fonts.source as
          "fontconfig" | "windows-installed-font-collection",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "fonts_preflight",
    {
      description:
        "Checks SVG-declared font families against the local cached font inventory; glyph coverage and embedding permissions remain explicitly unverified.",
      inputSchema: z.object({
        path: z.string().min(1).max(1024),
        refreshFonts: z.boolean().default(false),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        cached: z.boolean(),
        declaredFamilies: z.array(z.string()),
        genericFamilies: z.array(z.string()),
        missingFamilies: z.array(z.string()),
        presentFamilies: z.array(z.string()),
        source: z.enum(["fontconfig", "windows-installed-font-collection"]),
        warnings: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, refreshFonts, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const fonts = await systemFonts(refreshFonts);
      const preflight = preflightSvgFonts(
        await readFile(document.absolutePath, "utf8"),
        fonts.families,
      );
      const output = {
        ...preflight,
        cached: fonts.cached,
        source: fonts.source as
          "fontconfig" | "windows-installed-font-collection",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_snapshot",
    {
      description:
        "Creates an opaque, owner-bound snapshot of a document after verifying its exact revision.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          ttlMs: z
            .number()
            .int()
            .min(1_000)
            .max(7 * 24 * 60 * 60 * 1_000)
            .default(24 * 60 * 60 * 1_000),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        snapshotId: z.string().regex(/^snap_[a-f0-9]{32}$/u),
      }),
      annotations: { destructiveHint: false },
    },
    async ({ expectedRevision, path, ttlMs, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const snapshot = await snapshots.create(
        document.absolutePath,
        workspaceId,
        ttlMs,
        expectedRevision,
      );
      const output = { revision: snapshot.revision, snapshotId: snapshot.id };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_restore",
    {
      description:
        "Restores an owner-bound snapshot only when the current document revision matches exactly.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          snapshotId: z.string().regex(/^snap_[a-f0-9]{32}$/u),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, path, snapshotId, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const output = await snapshots.restore(
        snapshotId,
        workspaceId,
        document.absolutePath,
        expectedRevision,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_update",
    {
      description:
        "Updates bounded SVG geometry, basic styles, text, or layer labels through typed allowlisted patches.",
      inputSchema: z.object({
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        elements: z.array(elementUpdateSchema).min(1).max(100),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ elements, expectedRevision, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const updated = updateSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        elements,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(updated.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        ids: updated.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_arrange",
    {
      description:
        "Moves same-parent SVG elements to front, back, one step, a deterministic sibling index, or immediately before/after a sibling.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.enum(["back", "front", "lower", "raise"]),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("index"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          index: z.number().int().min(0).max(100_000),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.enum(["before", "after"]),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          path: z.string().min(1).max(1024),
          relativeTo: shapeIdSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum([
          "back",
          "front",
          "lower",
          "raise",
          "index",
          "before",
          "after",
        ]),
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        index: z.number().int().nonnegative().optional(),
        relativeTo: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      const { action, expectedRevision, ids, path, workspaceId } = input;
      const arrangeOptions =
        action === "index"
          ? { index: input.index }
          : action === "before" || action === "after"
            ? { relativeTo: input.relativeTo }
            : {};
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const arranged = arrangeSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        ids,
        action,
        arrangeOptions,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(arranged.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action,
        backupCreated: committed.backupPath !== undefined,
        ids: arranged.ids,
        ...(action === "index" ? { index: input.index } : {}),
        ...(action === "before" || action === "after"
          ? { relativeTo: input.relativeTo }
          : {}),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_group",
    {
      description:
        "Groups same-parent SVG elements or ungroups one non-layer group while preserving child order and rejecting broken href references.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("group"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          groupId: shapeIdSchema,
          ids: z.array(shapeIdSchema).min(1).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("ungroup"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          groupId: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["group", "ungroup"]),
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async (request) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(request.workspaceId, request.path);
      const grouped = groupSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        request.action === "group"
          ? {
              action: "group",
              groupId: request.groupId,
              ids: request.ids,
            }
          : { action: "ungroup", groupId: request.groupId },
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(grouped.svg),
        expectedOutputRevision: request.expectedRevision,
        expectedRevision: request.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: request.action,
        backupCreated: committed.backupPath !== undefined,
        ids: grouped.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_duplicate",
    {
      description:
        "Duplicates one simple SVG element independently or creates an explicit SVG use clone. Descendant IDs are rejected for independent copies until a remapping operation is requested.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          mode: z.enum(["copy", "use"]),
          newId: shapeIdSchema,
          parentId: shapeIdSchema.optional(),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        mode: z.enum(["copy", "use"]),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      expectedRevision,
      id,
      mode,
      newId,
      parentId,
      path,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const duplicated = duplicateSvgShape(
        await readFile(document.absolutePath, "utf8"),
        { id, mode, newId, ...(parentId === undefined ? {} : { parentId }) },
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(duplicated.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        id: duplicated.id,
        mode,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_reparent",
    {
      description:
        "Moves bounded SVG elements under one existing group or layer in source document order. It rejects cycles and ancestor-descendant selections.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          parentId: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, parentId, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const reparented = reparentSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        { ids, parentId },
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(reparented.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        ids: reparented.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "workspace_list",
    {
      description:
        "Lists authorized workspaces by opaque ID without exposing their filesystem roots.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        workspaces: z.array(z.object({ id: z.string() })),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => {
      assertDocumentWorkspace(config);
      const output = {
        workspaces: (await workspaces()).list().map(({ id }) => ({ id })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "workspace_list_documents",
    {
      description:
        "Lists allowed SVG/SVGZ document paths within one workspace using an opaque cursor.",
      inputSchema: z.object({
        cursor: z.string().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).default(50),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        documents: z.array(z.string()),
        nextCursor: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ cursor, pageSize, workspaceId }) => {
      assertDocumentWorkspace(config);
      const output = await (
        await workspaces()
      ).listDocuments(workspaceId, {
        ...(cursor === undefined ? {} : { cursor }),
        pageSize,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_import_svg",
    {
      description:
        "Imports one workspace-local SVG into a new sanitized SVG document. Scripts, event handlers and forbidden external references are removed according to the selected policy.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          outputPath: z.string().min(1).max(1024),
          path: z.string().min(1).max(1024),
          sanitizeMode: z
            .enum(["strict", "preserve-local", "trusted"])
            .default("preserve-local"),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        outputPath: z.string(),
        removed: z.array(z.string()),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      expectedRevision,
      outputPath,
      path,
      sanitizeMode,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.svg$/iu.test(output.relativePath))
        throw new Error("document_import_svg requires a .svg output path");
      const source = await readFile(input.absolutePath, "utf8");
      const sanitized = sanitizeSvg(source, {
        maxElements: 100_000,
        maxInputBytes: config.maxInputBytes,
        maximumMode: config.maximumSanitizeMode,
        mode: sanitizeMode,
      });
      const committed = await fileStore.commit({
        contents: Buffer.from(sanitized.svg, "utf8"),
        expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      const result = {
        outputPath: output.relativePath,
        removed: sanitized.removed,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "assets_package",
    {
      description:
        "Creates a portable workspace-local SVG package containing document.svg, rewritten local assets, and a revision manifest. Every package file is published together and existing files are never overwritten.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          assetLicenses: z
            .array(
              z
                .object({
                  license: z.string().min(1).max(256),
                  sourceUri: z.string().min(1).max(1024),
                })
                .strict(),
            )
            .max(98)
            .default([]),
          outputDirectory: z.string().min(1).max(1024),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        dependencyCount: z.number().int().nonnegative(),
        documentPath: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
          }),
        ),
        manifestPath: z.string(),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      assetLicenses,
      expectedRevision,
      outputDirectory,
      path,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.ensureOutputDirectory(
        workspaceId,
        outputDirectory,
      );
      const assets = await workspace.ensureOutputDirectory(
        workspaceId,
        `${output.relativePath}/assets`,
      );
      const packaged = await scratch.withDirectory(
        "staging",
        async (directory) => {
          const nativeInput = await createNativeInputBundle(
            input.absolutePath,
            expectedRevision,
            directory,
            {
              allowedRoot: input.workspaceRoot,
              maxDependencyBytes: config.maxInputBytes,
              maximumSanitizeMode: config.maximumSanitizeMode,
            },
          );
          if (nativeInput.manifest.dependencies.length > 98)
            throw new Error(
              "assets_package supports at most 98 local dependencies",
            );
          const licensesByUri = new Map<string, string>();
          for (const item of assetLicenses) {
            if (licensesByUri.has(item.sourceUri))
              throw new Error(
                "assets_package received duplicate asset licenses",
              );
            licensesByUri.set(item.sourceUri, item.license);
          }
          for (const dependency of nativeInput.manifest.dependencies)
            if (!licensesByUri.has(dependency.uri))
              throw new Error(
                `assets_package requires an explicit license for dependency: ${dependency.uri}`,
              );
          if (licensesByUri.size !== nativeInput.manifest.dependencies.length)
            throw new Error(
              "assets_package received a license for an unreferenced dependency",
            );
          const dependencies = await Promise.all(
            nativeInput.manifest.dependencies.map(async (dependency) => ({
              contents: await readFile(join(directory, dependency.path)),
              license: licensesByUri.get(dependency.uri)!,
              path: dependency.path,
              revision: dependency.revision,
            })),
          );
          const manifest = {
            dependencies: nativeInput.manifest.dependencies.map(
              ({ path: dependencyPath, revision, uri }) => ({
                license: licensesByUri.get(uri),
                path: dependencyPath,
                revision,
                sourceUri: uri,
              }),
            ),
            document: {
              path: "document.svg",
              revision: nativeInput.bundleRevision,
            },
            schema: "inkscape-mcp-assets-package/v1",
            source: { path: input.relativePath, revision: expectedRevision },
          };
          const manifestContents = Buffer.from(
            `${JSON.stringify(manifest, null, 2)}\n`,
            "utf8",
          );
          await nativeInput.assertCurrent();
          const committed = await fileStore.commitBatch({
            expectedRevision,
            files: [
              {
                contents: await readFile(nativeInput.path),
                targetPath: join(output.absolutePath, "document.svg"),
              },
              ...dependencies.map((dependency) => ({
                contents: dependency.contents,
                targetPath: join(assets.absolutePath, dependency.path.slice(7)),
              })),
              {
                contents: manifestContents,
                targetPath: join(output.absolutePath, "manifest.json"),
              },
            ],
            sourcePath: input.absolutePath,
          });
          const revisions = new Map(
            committed.files.map((file) => [file.targetPath, file.revision]),
          );
          return {
            dependencies,
            documentRevision: revisions.get(
              join(output.absolutePath, "document.svg"),
            ),
            manifestRevision: revisions.get(
              join(output.absolutePath, "manifest.json"),
            ),
          };
        },
      );
      if (!packaged.documentRevision || !packaged.manifestRevision)
        throw new Error("assets_package did not publish its complete package");
      const result = {
        dependencyCount: packaged.dependencies.length,
        documentPath: `${output.relativePath}/document.svg`,
        files: [
          { path: "document.svg", revision: packaged.documentRevision },
          ...packaged.dependencies.map((dependency) => ({
            path: dependency.path,
            revision: dependency.revision,
          })),
          { path: "manifest.json", revision: packaged.manifestRevision },
        ],
        manifestPath: `${output.relativePath}/manifest.json`,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "document_create",
    {
      description:
        "Creates a new SVG document from bounded custom dimensions or a named page preset. Existing outputs are never overwritten.",
      inputSchema: z.object({
        height: z.number().finite().positive().optional(),
        outputPath: z.string().min(1).max(1024),
        pages: z
          .array(
            z.object({
              height: z.number().finite().positive(),
              id: z
                .string()
                .regex(/^page_[A-Za-z0-9_-]{1,120}$/u)
                .optional(),
              label: z.string().min(1).max(256).optional(),
              width: z.number().finite().positive(),
              x: z.number().finite(),
              y: z.number().finite(),
            }),
          )
          .min(1)
          .max(100)
          .optional(),
        preset: pagePresetSchema.optional(),
        unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]).optional(),
        width: z.number().finite().positive().optional(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        documentPath: z.string(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: false },
    },
    async ({ height, outputPath, pages, preset, unit, width, workspaceId }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const target = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.svg$/iu.test(target.relativePath))
        throw new Error("document_create requires a .svg output path");
      const customProvided =
        height !== undefined || unit !== undefined || width !== undefined;
      if (preset !== undefined && customProvided)
        throw new Error("Provide either preset or width, height and unit");
      let page;
      if (preset !== undefined) {
        page = pageSizeFromPreset(preset);
      } else {
        if (height === undefined || unit === undefined || width === undefined)
          throw new Error("Provide either preset or width, height and unit");
        page = {
          width: { unit, value: width },
          height: { unit, value: height },
        };
      }
      let svg = createSvgDocument({ page });
      for (const initialPage of pages ?? [])
        svg = addSvgPage(svg, initialPage).svg;
      const result = await fileStore.commit({
        contents: Buffer.from(svg),
        targetPath: target.absolutePath,
      });
      const output = {
        documentPath: target.relativePath,
        revision: result.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_normalize_ids",
    {
      description:
        "Explicitly normalizes invalid or duplicate SVG IDs and rewrites supported local href, URL, ARIA and CSS references. Existing valid unique IDs remain unchanged.",
      inputSchema: z
        .object({
          assignMissingIds: z.boolean().default(false),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          prefix: z
            .string()
            .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/u)
            .default("svg"),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        renamed: z.array(
          z.object({
            from: z.string().optional(),
            reason: z.enum(["duplicate", "invalid", "missing"]),
            to: shapeIdSchema,
          }),
        ),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      assignMissingIds,
      expectedRevision,
      path,
      prefix,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const safety = sanitizeSvg(source, {
        maxElements: 100_000,
        maxInputBytes: config.maxInputBytes,
        maximumMode: config.maximumSanitizeMode,
        mode: "preserve-local",
      });
      if (safety.removed.length > 0)
        throw new Error("SVG must be sanitized before normalizing IDs");
      const normalized = normalizeSvgIds(source, {
        assignMissingIds,
        prefix,
      });
      const committed = await fileStore.commit({
        contents: Buffer.from(normalized.svg, "utf8"),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        renamed: normalized.renamed,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_create",
    {
      description:
        "Creates a bounded batch of typed SVG basic shapes without accepting XML or arbitrary attributes.",
      inputSchema: z.object({
        elements: z.array(shapeSchema).min(1).max(100),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ elements, expectedRevision, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const created = createSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        await prepareShapeSpecs(elements, document, workspace, config),
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(created.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        ids: created.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_apply_operations",
    {
      description:
        "Applies a bounded ordered design transaction to an SVG. Every operation is validated against the preceding in-memory result; a failure leaves the source untouched.",
      inputSchema: z
        .object({
          dryRun: z.boolean().default(false),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          operations: z.array(designOperationSchema).min(1).max(50),
          path: z.string().min(1).max(1024),
          version: z.literal(1).default(1),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        diff: semanticDiffSchema,
        dryRun: z.boolean(),
        estimatedCost: z.number().int().positive(),
        operations: z.number().int().positive(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        version: z.literal(1),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      dryRun,
      expectedRevision,
      operations,
      path,
      version,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const estimatedCost = estimateDesignOperationCost(operations);
      const aliases = new Map<string, string>();
      let svg = source;
      for (const operation of operations) {
        switch (operation.kind) {
          case "create": {
            const prepared = await prepareShapeSpecs(
              operation.elements,
              document,
              workspace,
              config,
            );
            const created = createSvgShapes(svg, prepared);
            if (operation.aliases !== undefined) {
              for (const [alias, id] of Object.entries(
                operation.aliases as Record<string, string>,
              )) {
                if (!created.ids.includes(id))
                  throw new Error(
                    "Transaction alias must name an ID created by its operation",
                  );
                registerTransactionAlias(aliases, alias, id);
              }
            }
            svg = created.svg;
            break;
          }
          case "update":
            svg = updateSvgShapes(
              svg,
              resolveTransactionElementUpdates(operation.elements, aliases),
            ).svg;
            break;
          case "transform":
            svg = transformSvgShapes(
              svg,
              resolveTransactionReferences(operation.ids, aliases),
              operation.transform,
            ).svg;
            break;
          case "arrange": {
            const { action, ids, ...options } = operation.request;
            const resolvedOptions =
              action === "before" || action === "after"
                ? {
                    relativeTo: resolveTransactionReference(
                      operation.request.relativeTo,
                      aliases,
                    ),
                  }
                : options;
            svg = arrangeSvgShapes(
              svg,
              resolveTransactionReferences(ids, aliases),
              action,
              resolvedOptions,
            ).svg;
            break;
          }
          case "group": {
            const request = operation.request;
            const result = groupSvgShapes(
              svg,
              request.action === "group"
                ? {
                    action: "group",
                    groupId: request.groupId,
                    ids: resolveTransactionReferences(request.ids, aliases),
                  }
                : {
                    action: "ungroup",
                    groupId: resolveTransactionReference(
                      request.groupId,
                      aliases,
                    ),
                  },
            );
            if (request.action === "group" && request.alias !== undefined)
              registerTransactionAlias(aliases, request.alias, request.groupId);
            svg = result.svg;
            break;
          }
          case "duplicate": {
            const result = duplicateSvgShape(svg, {
              id: resolveTransactionReference(operation.id, aliases),
              mode: operation.mode,
              newId: operation.newId,
              ...(operation.parentId === undefined
                ? {}
                : {
                    parentId: resolveTransactionReference(
                      operation.parentId,
                      aliases,
                    ),
                  }),
            });
            if (operation.alias !== undefined)
              registerTransactionAlias(aliases, operation.alias, result.id);
            svg = result.svg;
            break;
          }
          case "reparent":
            svg = reparentSvgShapes(svg, {
              ids: resolveTransactionReferences(operation.ids, aliases),
              parentId: resolveTransactionReference(
                operation.parentId,
                aliases,
              ),
            }).svg;
            break;
          case "delete":
            svg = deleteSvgShapes(
              svg,
              resolveTransactionReferences(operation.ids, aliases),
            ).svg;
            break;
        }
      }
      const diff = summarizeSvgDiff(source, svg);
      if (dryRun) {
        const output = {
          backupCreated: false,
          diff,
          dryRun: true,
          estimatedCost,
          operations: operations.length,
          revision: expectedRevision,
          version,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        diff,
        dryRun: false,
        estimatedCost,
        operations: operations.length,
        revision: committed.revision,
        version,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_query",
    {
      description:
        "Lists bounded SVG element summaries by IDs, type, layer, or one safe CSS compound selector without exposing arbitrary XML attributes.",
      inputSchema: z
        .object({
          ids: z.array(shapeIdSchema).max(100).optional(),
          expectedRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          includeBounds: z.boolean().default(false),
          includeComputedStyle: z.boolean().default(false),
          kinds: z
            .array(
              z.enum([
                "circle",
                "ellipse",
                "g",
                "image",
                "line",
                "path",
                "polygon",
                "polyline",
                "rect",
                "text",
                "use",
              ]),
            )
            .max(20)
            .optional(),
          layerId: shapeIdSchema.optional(),
          limit: z.number().int().min(1).max(1_000).default(100),
          offset: z.number().int().min(0).max(100_000).default(0),
          path: z.string().min(1).max(1024),
          selector: z.string().min(1).max(256).optional(),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        elements: z.array(elementSummarySchema),
        missingIds: z.array(shapeIdSchema),
        total: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({
      expectedRevision,
      ids,
      includeBounds,
      includeComputedStyle,
      kinds,
      layerId,
      limit,
      offset,
      path,
      selector,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const queried = querySvgElementTargets(
        await readFile(document.absolutePath, "utf8"),
        {
          ...(ids === undefined ? {} : { ids }),
          includeComputedStyle,
          ...(kinds === undefined ? {} : { kinds }),
          ...(layerId === undefined ? {} : { layerId }),
          ...(selector === undefined ? {} : { selector }),
          limit,
          offset,
        },
      );
      if (includeBounds && expectedRevision === undefined)
        throw new Error("Inkscape bounds require expectedRevision");
      const bounds =
        includeBounds && expectedRevision !== undefined
          ? await queryNativeBounds({
              config,
              documentPath: document.absolutePath,
              expectedRevision,
              runner,
              scratch,
              workspaceRoot: document.workspaceRoot,
            })
          : undefined;
      const output =
        bounds === undefined
          ? {
              ...queried,
              elements: queried.elements.map((element) => element.summary),
            }
          : {
              ...queried,
              elements: queried.elements.map((element) => {
                const bound =
                  element.nativeId === undefined
                    ? undefined
                    : bounds.get(element.nativeId);
                return bound === undefined
                  ? element.summary
                  : {
                      ...element.summary,
                      bounds: {
                        ...bound,
                        fidelity: nativeVisualBounds.fidelity,
                        kind: nativeVisualBounds.kind,
                        limitations: nativeVisualBounds.limitations,
                        source: "inkscape-query-all" as const,
                      },
                    };
              }),
            };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_delete",
    {
      description:
        "Deletes explicitly selected SVG elements and rejects deletions that would leave fragment references broken.",
      inputSchema: z.object({
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        ids: z.array(shapeIdSchema).min(1).max(100),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        deletedIds: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const deleted = deleteSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        ids,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(deleted.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        deletedIds: deleted.deletedIds,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_transform",
    {
      description:
        "Appends an allowlisted numeric SVG transform to selected elements without accepting transform strings.",
      inputSchema: z.object({
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        ids: z.array(shapeIdSchema).min(1).max(100),
        path: z.string().min(1).max(1024),
        transform: transformSchema,
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, path, transform, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const transformed = transformSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        ids,
        transform,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(transformed.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        ids: transformed.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "paths_combine",
    {
      description:
        "Combines same-parent SVG paths only when their presentation attributes match exactly and removed IDs have no live SVG references.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(2).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        removedIds: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const result = combineSvgPaths(
        await readFile(document.absolutePath, "utf8"),
        ids,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(result.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        id: result.id,
        removedIds: result.removedIds,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "masks_manage",
    {
      description:
        "Creates typed opaque rectangular SVG masks, applies or releases them from explicit elements, and prevents deletion while any SVG or CSS reference remains.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: z.object({
            height: z.number().finite().positive(),
            id: shapeIdSchema,
            width: z.number().finite().positive(),
            x: z.number().finite(),
            y: z.number().finite(),
          }),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("release"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "apply", "release", "delete"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      const changed =
        input.action === "create"
          ? createSvgRectMask(source, input.spec)
          : input.action === "apply"
            ? applySvgMask(source, input.id, input.targetIds)
            : input.action === "release"
              ? releaseSvgMask(source, input.targetIds)
              : deleteSvgMask(source, input.id);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        ...("id" in input ? { id: input.id } : {}),
        revision: committed.revision,
        ...("targetIds" in input ? { targetIds: input.targetIds } : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "clips_manage",
    {
      description:
        "Creates typed rectangular SVG clipPaths, applies or releases them from explicit elements, and prevents deletion while any SVG or CSS reference remains.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: z.object({
            height: z.number().finite().positive(),
            id: shapeIdSchema,
            units: z.enum(["objectBoundingBox", "userSpaceOnUse"]).optional(),
            width: z.number().finite().positive(),
            x: z.number().finite(),
            y: z.number().finite(),
          }),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("release"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "apply", "release", "delete"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      const changed =
        input.action === "create"
          ? createSvgRectClipPath(source, input.spec)
          : input.action === "apply"
            ? applySvgClipPath(source, input.id, input.targetIds)
            : input.action === "release"
              ? releaseSvgClipPath(source, input.targetIds)
              : deleteSvgClipPath(source, input.id);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        ...("id" in input ? { id: input.id } : {}),
        revision: committed.revision,
        ...("targetIds" in input ? { targetIds: input.targetIds } : {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "images_crop",
    {
      description:
        "Crops one SVG image non-destructively by applying a new local user-space clipPath; the original image href and geometry remain unchanged.",
      inputSchema: z
        .object({
          clipId: shapeIdSchema,
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          height: z.number().finite().positive(),
          imageId: shapeIdSchema,
          path: z.string().min(1).max(1024),
          width: z.number().finite().positive(),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
          x: z.number().finite(),
          y: z.number().finite(),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        clipId: shapeIdSchema,
        imageId: shapeIdSchema,
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      clipId,
      expectedRevision,
      height,
      imageId,
      path,
      width,
      workspaceId,
      x,
      y,
    }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const changed = cropSvgImage(
        await readFile(document.absolutePath, "utf8"),
        { clipId, height, imageId, width, x, y },
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        clipId,
        imageId,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "text_manage",
    {
      description:
        "Edits local SVG text through bounded plain-text segments or explicit multiline tspans, preserving existing structure only when requested.",
      inputSchema: z.discriminatedUnion("mode", [
        z.object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          layout: textLayoutSchema.optional(),
          mode: z.literal("preserve_structure"),
          path: z.string().min(1).max(1024),
          segments: z.array(z.string().min(0).max(10_000)).min(1).max(500),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          layout: textLayoutSchema.optional(),
          lineHeight: z.number().finite().positive().optional(),
          lines: z
            .array(z.array(textSpanSchema).min(1).max(100))
            .min(1)
            .max(200),
          mode: z.literal("replace_structure"),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        mode: z.enum(["preserve_structure", "replace_structure"]),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const changed = updateSvgText(
        await readFile(document.absolutePath, "utf8"),
        input,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        id: input.id,
        mode: input.mode,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "text_path_manage",
    {
      description:
        "Attaches text (including tspans) to a local SVG path or detaches it without accepting markup.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("attach"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          pathId: shapeIdSchema,
          startOffset: z.number().finite().optional(),
          textId: shapeIdSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("detach"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          textId: shapeIdSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["attach", "detach"]),
        backupCreated: z.boolean(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        textId: shapeIdSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      const changed =
        input.action === "attach"
          ? attachSvgTextToPath(
              source,
              input.textId,
              input.pathId,
              input.startOffset,
            )
          : detachSvgTextFromPath(source, input.textId);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        revision: committed.revision,
        textId: input.textId,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "metadata_manage",
    {
      description:
        "Updates SVG document metadata or element accessibility with bounded plain text and no arbitrary RDF/XML.",
      inputSchema: z.discriminatedUnion("action", [
        z
          .object({
            action: z.literal("document"),
            description: z.string().min(1).max(2_000).optional(),
            expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
            license: z.string().min(1).max(2_000).optional(),
            path: z.string().min(1).max(1024),
            title: z.string().min(1).max(2_000).optional(),
            workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
          })
          .refine(
            (value) =>
              value.title !== undefined ||
              value.description !== undefined ||
              value.license !== undefined,
            "Metadata requires at least one patch",
          ),
        z.object({
          action: z.literal("elements"),
          elements: z
            .array(
              z
                .object({
                  description: z.string().min(1).max(2_000).optional(),
                  hidden: z.boolean().optional(),
                  id: shapeIdSchema,
                  label: z.string().min(1).max(2_000).optional(),
                  title: z.string().min(1).max(2_000).optional(),
                })
                .refine(
                  (value) =>
                    value.label !== undefined ||
                    value.title !== undefined ||
                    value.description !== undefined ||
                    value.hidden !== undefined,
                  "Accessibility element requires at least one patch",
                ),
            )
            .min(1)
            .max(100),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["document", "elements"]),
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema).optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      const changed =
        input.action === "document"
          ? updateSvgDocumentMetadata(source, input)
          : updateSvgElementAccessibility(source, input.elements);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        ...(input.action === "elements"
          ? { ids: input.elements.map((element) => element.id) }
          : {}),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "defs_vacuum",
    {
      description:
        "Plans or conservatively removes unused top-level SVG definitions. Defaults to dry-run and never rewrites referenced resources.",
      inputSchema: z.object({
        dryRun: z.boolean().default(true),
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean().optional(),
        candidateIds: z.array(z.string().min(1).max(1024)),
        dryRun: z.boolean(),
        removedIds: z.array(z.string().min(1).max(1024)),
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ dryRun, expectedRevision, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      if (dryRun) {
        const plan = planUnusedSvgDefs(source);
        const output = { ...plan, dryRun: true };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
      if (expectedRevision === undefined)
        throw new Error("expectedRevision is required when dryRun is false");
      const result = vacuumUnusedSvgDefs(source);
      const committed = await fileStore.commit({
        contents: Buffer.from(result.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        ...result.plan,
        backupCreated: committed.backupPath !== undefined,
        dryRun: false,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "filters_manage",
    {
      description:
        "Creates, replaces, applies, releases or safely deletes typed SVG blur, drop-shadow, blend and color-matrix filters without accepting arbitrary XML.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: filterSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("update"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: filterSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("release"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "update", "delete", "apply", "release"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      let changed: string;
      let id: string | undefined;
      let targetIds: readonly string[] | undefined;
      if (input.action === "create" || input.action === "update") {
        changed =
          input.action === "create"
            ? createSvgFilter(source, input.spec)
            : updateSvgFilter(source, input.spec);
        id = input.spec.id;
      } else if (input.action === "delete") {
        changed = deleteSvgFilter(source, input.id);
        id = input.id;
      } else if (input.action === "apply") {
        changed = applySvgFilter(source, input.id, input.targetIds);
        id = input.id;
        targetIds = input.targetIds;
      } else {
        changed = releaseSvgFilter(source, input.targetIds);
        targetIds = input.targetIds;
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        ...(id === undefined ? {} : { id }),
        ...(targetIds === undefined ? {} : { targetIds }),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "markers_manage",
    {
      description:
        "Creates, replaces, applies or deletes typed SVG arrow/dot markers without accepting free path data or XML.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: markerSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("update"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: markerSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          position: z.enum(["start", "mid", "end"]),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "update", "delete", "apply"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      let changed: string;
      let id: string;
      let targetIds: readonly string[] | undefined;
      if (input.action === "create" || input.action === "update") {
        changed =
          input.action === "create"
            ? createSvgMarker(source, input.spec)
            : updateSvgMarker(source, input.spec);
        id = input.spec.id;
      } else if (input.action === "delete") {
        changed = deleteSvgMarker(source, input.id);
        id = input.id;
      } else {
        changed = applySvgMarker(
          source,
          input.id,
          input.targetIds,
          input.position,
        );
        id = input.id;
        targetIds = input.targetIds;
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        id,
        ...(targetIds === undefined ? {} : { targetIds }),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "patterns_manage",
    {
      description:
        "Creates, replaces, applies or deletes typed SVG dots/stripes patterns in defs without accepting free XML or CSS.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: patternSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("update"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: patternSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          paint: z.enum(["fill", "stroke"]),
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "update", "delete", "apply"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      let changed: string;
      let id: string;
      let targetIds: readonly string[] | undefined;
      if (input.action === "create" || input.action === "update") {
        changed =
          input.action === "create"
            ? createSvgPattern(source, input.spec)
            : updateSvgPattern(source, input.spec);
        id = input.spec.id;
      } else if (input.action === "delete") {
        changed = deleteSvgPattern(source, input.id);
        id = input.id;
      } else {
        changed = applySvgPattern(
          source,
          input.id,
          input.targetIds,
          input.paint,
        );
        id = input.id;
        targetIds = input.targetIds;
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        id,
        ...(targetIds === undefined ? {} : { targetIds }),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "gradients_manage",
    {
      description:
        "Creates, replaces, applies or deletes typed SVG linear/radial gradients in <defs> without accepting free XML or CSS.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: gradientSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("update"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          spec: gradientSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("delete"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
        z.object({
          action: z.literal("apply"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          paint: z.enum(["fill", "stroke"]),
          path: z.string().min(1).max(1024),
          targetIds: z.array(shapeIdSchema).min(1).max(100),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        }),
      ]),
      outputSchema: z.object({
        action: z.enum(["create", "update", "delete", "apply"]),
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        targetIds: z.array(shapeIdSchema).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(input.workspaceId, input.path);
      const source = await readFile(document.absolutePath, "utf8");
      let changed: string;
      let id: string;
      let targetIds: readonly string[] | undefined;
      if (input.action === "create" || input.action === "update") {
        changed =
          input.action === "create"
            ? createSvgGradient(source, input.spec)
            : updateSvgGradient(source, input.spec);
        id = input.spec.id;
      } else if (input.action === "delete") {
        changed = deleteSvgGradient(source, input.id);
        id = input.id;
      } else {
        changed = applySvgGradient(
          source,
          input.id,
          input.targetIds,
          input.paint,
        );
        id = input.id;
        targetIds = input.targetIds;
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        action: input.action,
        backupCreated: committed.backupPath !== undefined,
        id,
        ...(targetIds === undefined ? {} : { targetIds }),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "paths_boolean",
    {
      description:
        "Runs Inkscape's native union, difference, intersection or exclusion on exactly two safe SVG path IDs in a staged copy, then atomically publishes the sanitized result.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).length(2),
          operation: z.enum([
            "union",
            "difference",
            "intersection",
            "exclusion",
          ]),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        diff: semanticDiffSchema,
        operation: z.enum(["union", "difference", "intersection", "exclusion"]),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, operation, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const result = await runNativePathBoolean({
        config,
        document,
        expectedRevision,
        ids,
        operation,
        runner,
        scratch,
      });
      const diff = summarizeSvgDiff(source, result);
      const committed = await fileStore.commit({
        contents: Buffer.from(result),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        diff,
        operation,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "path_break_apart",
    {
      description:
        "Splits a compound SVG path into explicit, caller-supplied IDs. Existing references to the source ID are rejected before mutation.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          newIds: z.array(shapeIdSchema).min(2).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, id, newIds, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const result = breakApartSvgPath(
        await readFile(document.absolutePath, "utf8"),
        id,
        newIds,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(result.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        ids: result.ids,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "path_reverse",
    {
      description:
        "Reverses line-only SVG path subpaths while retaining the path ID and presentation. Curves and arcs are rejected until their exact reversal is available.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          id: shapeIdSchema,
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        id: shapeIdSchema,
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, id, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const result = reverseSvgPath(
        await readFile(document.absolutePath, "utf8"),
        id,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(result.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        id: result.id,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_flatten_transform",
    {
      description:
        "Bakes each selected element's own axis-aligned translate/scale/matrix transform into safe primitive geometry. It rejects rotation, skew, paths and inherited transforms rather than changing SVG semantics.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        flattenedIds: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, ids, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const flattened = flattenSvgShapeTransforms(
        await readFile(document.absolutePath, "utf8"),
        ids,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(flattened.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        flattenedIds: flattened.flattenedIds,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_align",
    {
      description:
        "Aligns SVG elements to a selection, page, coordinate or another element using Inkscape visual bounds; selected ancestors and descendants are rejected.",
      inputSchema: z
        .object({
          alignment: z.enum([
            "left",
            "center",
            "right",
            "top",
            "middle",
            "bottom",
          ]),
          anchor: layoutAnchorSchema.default({ kind: "selection" }),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        alignment: z.enum([
          "left",
          "center",
          "right",
          "top",
          "middle",
          "bottom",
        ]),
        backupCreated: z.boolean(),
        moves: z.array(layoutMoveSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ alignment, anchor, expectedRevision, ids, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      assertNoNestedLayoutSelection(source, ids);
      const nativeBounds = await queryNativeBounds({
        config,
        documentPath: document.absolutePath,
        expectedRevision,
        runner,
        scratch,
        workspaceRoot: document.workspaceRoot,
      });
      const selected = requireLayoutBounds(ids, nativeBounds);
      const reference = resolveLayoutAnchor(
        anchor,
        source,
        selected,
        nativeBounds,
      );
      const moves = planAlignment(selected, alignment, reference);
      const changed = applyLayoutMoves(source, moves);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        alignment,
        backupCreated: committed.backupPath !== undefined,
        moves,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "elements_distribute",
    {
      description:
        "Distributes SVG elements by visual edges, centres or gaps using native Inkscape bounds, preserving the first and last element on the chosen axis.",
      inputSchema: z
        .object({
          axis: z.enum(["horizontal", "vertical"]),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(3).max(100),
          mode: z.enum(["edges", "centers", "gaps"]),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        axis: z.enum(["horizontal", "vertical"]),
        backupCreated: z.boolean(),
        mode: z.enum(["edges", "centers", "gaps"]),
        moves: z.array(layoutMoveSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ axis, expectedRevision, ids, mode, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      assertNoNestedLayoutSelection(source, ids);
      const nativeBounds = await queryNativeBounds({
        config,
        documentPath: document.absolutePath,
        expectedRevision,
        runner,
        scratch,
        workspaceRoot: document.workspaceRoot,
      });
      const moves = planDistribution(
        requireLayoutBounds(ids, nativeBounds),
        axis,
        mode,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(applyLayoutMoves(source, moves)),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        axis,
        backupCreated: committed.backupPath !== undefined,
        mode,
        moves,
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_inspect",
    {
      description:
        "Reads SVG settings and a bounded, redacted design inventory from an authorized document without mutating it.",
      inputSchema: z.object({
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        includeVisualBounds: z.boolean().default(false),
        inventoryKinds: z
          .array(z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,127}$/u))
          .max(100)
          .optional(),
        inventoryLimit: z.number().int().min(1).max(1_000).optional(),
        inventoryOffset: z.number().int().min(0).max(100_000).default(0),
        level: z.enum(["summary", "standard", "deep"]).default("standard"),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        ambiguousViewport: z.boolean(),
        height: z.string(),
        heightUnit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
        inspectionLevel: z.enum(["summary", "standard", "deep"]),
        inventory: inventorySchema.optional(),
        normalization: z.object({
          height: z.object({
            raw: z.string().optional(),
            source: z.enum(["defaulted", "explicit", "percentage_fallback"]),
          }),
          viewBox: z.enum(["explicit", "inferred_from_viewport"]),
          width: z.object({
            raw: z.string().optional(),
            source: z.enum(["defaulted", "explicit", "percentage_fallback"]),
          }),
        }),
        pages: z.array(pageSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        viewBox: z.object({
          height: z.number(),
          width: z.number(),
          x: z.number(),
          y: z.number(),
        }),
        visualBounds: visualBoundsSchema.optional(),
        width: z.string(),
        widthUnit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
        warnings: z.array(
          z.enum([
            "VIEWBOX_MISSING_INFERRED_FROM_VIEWPORT",
            "VIEWPORT_HEIGHT_DEFAULTED",
            "VIEWPORT_HEIGHT_PERCENTAGE_UNRESOLVED",
            "VIEWPORT_HEIGHT_UNITLESS_NORMALIZED",
            "VIEWPORT_WIDTH_DEFAULTED",
            "VIEWPORT_WIDTH_PERCENTAGE_UNRESOLVED",
            "VIEWPORT_WIDTH_UNITLESS_NORMALIZED",
          ]),
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({
      expectedRevision,
      includeVisualBounds,
      inventoryKinds,
      inventoryLimit,
      inventoryOffset,
      level,
      path,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const revision = await sha256File(document.absolutePath);
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw new Error("Document revision no longer matches");
      if (includeVisualBounds && expectedRevision === undefined)
        throw new Error("Inkscape bounds require expectedRevision");
      const source = await readFile(document.absolutePath, "utf8");
      const settings = inspectSvgSettings(source);
      const explicitPages = listSvgPages(source);
      const visualBounds =
        includeVisualBounds && expectedRevision !== undefined
          ? inventoryVisualBounds(
              await queryNativeBounds({
                config,
                documentPath: document.absolutePath,
                expectedRevision,
                runner,
                scratch,
                workspaceRoot: document.workspaceRoot,
              }),
              explicitPages.length === 0
                ? [
                    {
                      height: settings.viewBox.height,
                      id: "root_viewbox",
                      width: settings.viewBox.width,
                      x: settings.viewBox.x,
                      y: settings.viewBox.y,
                    },
                  ]
                : explicitPages,
            )
          : undefined;
      const output = {
        ...settings,
        heightUnit: parseViewportLength(settings.height).unit,
        inspectionLevel: level,
        ...(level === "summary"
          ? {}
          : {
              inventory: inspectSvgInventory(source, {
                detailLimit: inventoryLimit ?? (level === "deep" ? 1_000 : 100),
                ...(inventoryKinds === undefined
                  ? {}
                  : { kinds: inventoryKinds }),
                offset: inventoryOffset,
              }),
            }),
        pages: explicitPages,
        revision,
        ...(visualBounds === undefined ? {} : { visualBounds }),
        widthUnit: parseViewportLength(settings.width).unit,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_preflight",
    {
      description:
        "Runs a read-only basic, web, print, or interchange preflight without opening linked resources.",
      inputSchema: z.object({
        bleed: bleedSpecSchema.optional(),
        path: z.string().min(1).max(1024),
        profile: z
          .enum(["basic", "web", "print", "interchange"])
          .default("basic"),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        issues: z.array(
          z.object({
            code: z.string(),
            message: z.string(),
            remediation: z.string(),
            severity: z.enum(["error", "warning"]),
          }),
        ),
        print: printPreflightSchema.optional(),
        profile: z.enum(["basic", "web", "print", "interchange"]),
        valid: z.boolean(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ bleed, path, profile, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const preflight = preflightSvg(
        await readFile(document.absolutePath, "utf8"),
        profile,
        {
          ...(bleed === undefined ? {} : { bleed }),
          rasterMegapixelThreshold: config.maxRasterMegapixels,
        },
      );
      const output = {
        issues: preflight.issues,
        ...(preflight.print === undefined ? {} : { print: preflight.print }),
        profile: preflight.profile,
        valid: !preflight.issues.some((issue) => issue.severity === "error"),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_resize",
    {
      description:
        "Changes the SVG page size with page_only semantics while preserving element geometry. Requires the current document revision.",
      inputSchema: z.object({
        anchor: z
          .enum([
            "top_left",
            "top_center",
            "top_right",
            "center_left",
            "center",
            "center_right",
            "bottom_left",
            "bottom_center",
            "bottom_right",
          ])
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        dryRun: z.boolean().default(false),
        height: z.number().finite().positive(),
        mode: z
          .enum([
            "page_only",
            "scale_content_contain",
            "scale_content_cover",
            "scale_content_stretch",
          ])
          .default("page_only"),
        path: z.string().min(1).max(1024),
        unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
        width: z.number().finite().positive(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        dryRun: z.boolean(),
        predicted: z
          .object({
            diff: z.object({
              addedIds: z.array(z.string()),
              afterElementCount: z.number().int().nonnegative(),
              ambiguousIds: z.array(z.string()),
              beforeElementCount: z.number().int().nonnegative(),
              changedIds: z.array(z.string()),
              removedIds: z.array(z.string()),
            }),
            page: z.object({
              height: viewportLengthSchema,
              viewBox: z.object({
                height: z.number().positive(),
                width: z.number().positive(),
                x: z.number().finite(),
                y: z.number().finite(),
              }),
              width: viewportLengthSchema,
            }),
            transform: z
              .tuple([
                z.number().finite(),
                z.number().finite(),
                z.number().finite(),
                z.number().finite(),
                z.number().finite(),
                z.number().finite(),
              ])
              .optional(),
            warnings: z.array(z.string()),
          })
          .optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      anchor,
      expectedRevision,
      dryRun,
      height,
      mode,
      path,
      unit,
      width,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const currentRevision = await sha256File(document.absolutePath);
      if (currentRevision !== expectedRevision)
        throw new Error("Document revision no longer matches");
      const settings = inspectSvgSettings(source);
      const currentPage = {
        width: parseViewportLength(settings.width),
        height: parseViewportLength(settings.height),
      };
      const targetPage = {
        width: { unit, value: width },
        height: { unit, value: height },
      };
      const resized =
        mode === "page_only"
          ? resizePageOnlySvg(source, currentPage, targetPage, anchor)
          : resizeContentSvg(source, currentPage, targetPage, mode, anchor);
      if (dryRun) {
        const predictedSettings = inspectSvgSettings(resized.svg);
        const output = {
          backupCreated: false,
          dryRun: true,
          predicted: {
            diff: summarizeSvgDiff(source, resized.svg),
            page: {
              height: parseViewportLength(predictedSettings.height),
              viewBox: predictedSettings.viewBox,
              width: parseViewportLength(predictedSettings.width),
            },
            ...(resized.transform === undefined
              ? {}
              : { transform: resized.transform }),
            warnings: resized.warnings,
          },
          revision: currentRevision,
          warnings: resized.warnings,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
      const result = await fileStore.commit({
        contents: Buffer.from(resized.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: result.backupPath !== undefined,
        dryRun: false,
        revision: result.revision,
        warnings: resized.warnings,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_fit_page",
    {
      description:
        "Fits a page to native visual drawing or selected-object bounds with explicit per-side margins. This never transforms objects.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          ids: z.array(shapeIdSchema).min(1).max(100).optional(),
          margins: pageMarginsSchema.default({
            bottom: 0,
            left: 0,
            right: 0,
            top: 0,
          }),
          path: z.string().min(1).max(1024),
          scope: z.enum(["drawing", "selection"]),
          unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        bounds: z.object({
          height: z.number().positive(),
          width: z.number().positive(),
          x: z.number().finite(),
          y: z.number().finite(),
        }),
        boundsFidelity: z.literal("partial"),
        page: z.object({
          height: viewportLengthSchema,
          width: viewportLengthSchema,
        }),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      expectedRevision,
      ids,
      margins,
      path,
      scope,
      unit,
      workspaceId,
    }) => {
      if (scope === "selection" && ids === undefined)
        throw new Error("Selection fit requires at least one element ID");
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const settings = inspectSvgSettings(source);
      const nativeBounds = await queryNativeBounds({
        config,
        documentPath: document.absolutePath,
        expectedRevision,
        runner,
        scratch,
        workspaceRoot: document.workspaceRoot,
      });
      const selected =
        scope === "drawing"
          ? [...nativeBounds.values()]
          : ids!.map((id) => {
              const bounds = nativeBounds.get(id);
              if (!bounds)
                throw new Error("Selected element has no native visual bounds");
              return bounds;
            });
      const bounds = unionBounds(selected);
      const currentPage = {
        height: parseViewportLength(settings.height),
        width: parseViewportLength(settings.width),
      };
      const marginLengths = {
        bottom: { unit, value: margins.bottom },
        left: { unit, value: margins.left },
        right: { unit, value: margins.right },
        top: { unit, value: margins.top },
      } as const;
      const fitted = fitPageToBoundsSvg(
        source,
        currentPage,
        bounds,
        marginLengths,
        unit,
      );
      const committed = await fileStore.commit({
        contents: Buffer.from(fitted.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        bounds,
        boundsFidelity: "partial" as const,
        page: fitted.page,
        revision: committed.revision,
        warnings: fitted.warnings,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_page_adjust",
    {
      description:
        "Crops, expands or changes page orientation with explicit physical margins, preserving object geometry.",
      inputSchema: z
        .object({
          action: z.enum(["crop", "expand", "toggle_orientation"]),
          anchor: z
            .enum([
              "top_left",
              "top_center",
              "top_right",
              "center_left",
              "center",
              "center_right",
              "bottom_left",
              "bottom_center",
              "bottom_right",
            ])
            .default("top_left"),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          margins: pageMarginsSchema.optional(),
          path: z.string().min(1).max(1024),
          unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        backupCreated: z.boolean(),
        page: z.object({
          height: viewportLengthSchema,
          width: viewportLengthSchema,
        }),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      action,
      anchor,
      expectedRevision,
      margins,
      path,
      unit,
      workspaceId,
    }) => {
      if (action !== "toggle_orientation" && margins === undefined)
        throw new Error("Crop or expand requires explicit margins");
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const settings = inspectSvgSettings(source);
      const currentPage = {
        height: parseViewportLength(settings.height),
        width: parseViewportLength(settings.width),
      };
      const adjusted =
        action === "toggle_orientation"
          ? changePageOrientationSvg(source, currentPage, anchor)
          : adjustPageMarginsSvg(
              source,
              currentPage,
              {
                bottom: { unit, value: margins!.bottom },
                left: { unit, value: margins!.left },
                right: { unit, value: margins!.right },
                top: { unit, value: margins!.top },
              },
              action,
            );
      const committed = await fileStore.commit({
        contents: Buffer.from(adjusted.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: committed.backupPath !== undefined,
        page: adjusted.page,
        revision: committed.revision,
        warnings: adjusted.warnings,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_pages",
    {
      description:
        "Lists or safely changes explicit Inkscape 1.4 pages by stable page ID. Mutations require the current document revision.",
      inputSchema: z.object({
        action: z.enum(["list", "add", "update", "delete", "reorder"]),
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        page: z
          .object({
            height: z.number().finite().positive(),
            id: z
              .string()
              .regex(/^page_[A-Za-z0-9_-]{1,120}$/u)
              .optional(),
            label: z.string().min(1).max(256).optional(),
            width: z.number().finite().positive(),
            x: z.number().finite(),
            y: z.number().finite(),
          })
          .optional(),
        pageId: z
          .string()
          .regex(/^page_[A-Za-z0-9_-]{1,120}$/u)
          .optional(),
        pageIds: z
          .array(z.string().regex(/^page_[A-Za-z0-9_-]{1,120}$/u))
          .max(1_000)
          .optional(),
        patch: z
          .object({
            height: z.number().finite().positive().optional(),
            label: z.string().min(1).max(256).optional(),
            width: z.number().finite().positive().optional(),
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
          })
          .optional(),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        pages: z.array(pageSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      action,
      expectedRevision,
      page,
      pageId,
      pageIds,
      patch,
      path,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const currentRevision = await sha256File(document.absolutePath);
      if (action === "list") {
        if (
          expectedRevision !== undefined &&
          expectedRevision !== currentRevision
        )
          throw new Error("Document revision no longer matches");
        const output = {
          pages: listSvgPages(source),
          revision: currentRevision,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
      if (!expectedRevision)
        throw new Error("Page mutations require expectedRevision");
      let changed: string;
      switch (action) {
        case "add":
          if (!page) throw new Error("Adding a page requires page");
          changed = addSvgPage(source, page).svg;
          break;
        case "update":
          if (!pageId || !patch)
            throw new Error("Updating a page requires pageId and patch");
          changed = updateSvgPage(source, pageId, patch).svg;
          break;
        case "delete":
          if (!pageId) throw new Error("Deleting a page requires pageId");
          changed = deleteSvgPage(source, pageId);
          break;
        case "reorder":
          if (!pageIds) throw new Error("Reordering pages requires pageIds");
          changed = reorderSvgPages(source, pageIds);
          break;
        default:
          throw new Error("Unsupported page action");
      }
      const committed = await fileStore.commit({
        contents: Buffer.from(changed),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        pages: listSvgPages(changed),
        revision: committed.revision,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_page_validate",
    {
      description:
        "Validates explicit Inkscape page overlap, empty pages and objects outside every page using native visual bounds.",
      inputSchema: z
        .object({
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        boundsFidelity: z.literal("partial"),
        pages: z.array(pageSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        validation: z.object({
          emptyPageIds: z.array(z.string()),
          outsideObjectIds: z.array(z.string()),
          overlaps: z.array(
            z.object({
              area: z.object({
                height: z.number().positive(),
                width: z.number().positive(),
                x: z.number().finite(),
                y: z.number().finite(),
              }),
              pageIds: z.tuple([z.string(), z.string()]),
            }),
          ),
        }),
        warnings: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ expectedRevision, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const currentRevision = await sha256File(document.absolutePath);
      if (currentRevision !== expectedRevision)
        throw new Error("Document revision no longer matches");
      const pages = listSvgPages(source);
      const nativeBounds = await queryNativeBounds({
        config,
        documentPath: document.absolutePath,
        expectedRevision,
        runner,
        scratch,
        workspaceRoot: document.workspaceRoot,
      });
      const validation = validateSvgPageLayout(
        pages,
        [...nativeBounds.entries()].map(([id, bounds]) => ({ id, ...bounds })),
      );
      const output = {
        boundsFidelity: "partial" as const,
        pages,
        revision: currentRevision,
        validation,
        warnings:
          pages.length === 0
            ? ["NO_EXPLICIT_INKSCAPE_PAGES"]
            : ["OBJECT_VALIDATION_USES_VISUAL_BOUNDS"],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_settings",
    {
      description:
        "Reads or updates typed Inkscape page, desk and border display settings. Updates require the current document revision.",
      inputSchema: z.object({
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        path: z.string().min(1).max(1024),
        settings: z
          .object({
            borderColor: z
              .string()
              .regex(/^#[a-fA-F0-9]{6}$/u)
              .optional(),
            borderOpacity: z.number().finite().min(0).max(1).optional(),
            deskColor: z
              .string()
              .regex(/^#[a-fA-F0-9]{6}$/u)
              .optional(),
            pageColor: z
              .string()
              .regex(/^#[a-fA-F0-9]{6}$/u)
              .optional(),
            pageOpacity: z.number().finite().min(0).max(1).optional(),
          })
          .optional(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        settings: displaySettingsSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ expectedRevision, path, settings, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const currentRevision = await sha256File(document.absolutePath);
      if (settings === undefined) {
        if (
          expectedRevision !== undefined &&
          expectedRevision !== currentRevision
        )
          throw new Error("Document revision no longer matches");
        const output = {
          revision: currentRevision,
          settings: inspectDocumentDisplaySettings(source),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
      if (!expectedRevision)
        throw new Error("Changing document settings requires expectedRevision");
      if (Object.keys(settings).length === 0)
        throw new Error(
          "Changing document settings requires at least one value",
        );
      const changed = updateDocumentDisplaySettings(source, settings);
      const committed = await fileStore.commit({
        contents: Buffer.from(changed.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        revision: committed.revision,
        settings: changed.settings,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "document_render_preview",
    {
      description:
        "Renders a bounded transparent PNG preview through Inkscape without changing the source document. Small results are returned inline and every preview is saved to an authorized workspace path.",
      inputSchema: z
        .object({
          area: z.enum(["drawing", "page", "selection"]).default("page"),
          expectedOutputRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          height: z.number().int().positive().max(PREVIEW_MAX_AXIS).optional(),
          outputPath: z.string().min(1).max(1024),
          pageId: shapeIdSchema.optional(),
          path: z.string().min(1).max(1024),
          selectionId: shapeIdSchema.optional(),
          width: z
            .number()
            .int()
            .positive()
            .max(PREVIEW_MAX_AXIS)
            .default(1_024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .superRefine((value, context) => {
          if (value.area === "selection" && value.selectionId === undefined)
            context.addIssue({
              code: "custom",
              message: "Selection preview requires selectionId",
              path: ["selectionId"],
            });
          if (value.area !== "selection" && value.selectionId !== undefined)
            context.addIssue({
              code: "custom",
              message: "selectionId is only valid for a selection preview",
              path: ["selectionId"],
            });
          if (value.area !== "page" && value.pageId !== undefined)
            context.addIssue({
              code: "custom",
              message: "pageId is only valid for a page preview",
              path: ["pageId"],
            });
        }),
      outputSchema: z.object({
        area: z.enum(["drawing", "page", "selection"]),
        artifact: artifactSchema,
        cache: z.enum(["hit", "miss"]),
        documentPath: z.string(),
        height: z.number().int().positive(),
        inline: z.boolean(),
        pageId: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        selectionId: shapeIdSchema.optional(),
        width: z.number().int().positive(),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      area,
      expectedOutputRevision,
      expectedRevision,
      height,
      outputPath,
      pageId,
      path,
      selectionId,
      width,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.png$/iu.test(output.relativePath))
        throw new Error("document_render_preview requires a .png output path");
      if ((await sha256File(input.absolutePath)) !== expectedRevision)
        throw new Error("Document revision no longer matches");
      const source = await readFile(input.absolutePath, "utf8");
      const normalizedArea = normalizeExportArea(
        area === "selection"
          ? { elementId: selectionId!, kind: "selection" }
          : area === "page"
            ? { kind: "page", ...(pageId === undefined ? {} : { pageId }) }
            : { kind: "drawing" },
        listSvgPages(source),
      );
      if (normalizedArea.selectionId !== undefined) {
        const selection = querySvgElementTargets(source, {
          ids: [normalizedArea.selectionId],
          limit: 1,
          offset: 0,
        });
        if (selection.missingIds.length > 0)
          throw new Error("Preview selection element does not exist");
      }
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const cacheKey = previewCacheKey({
        area: normalizedArea,
        expectedRevision,
        height,
        inkscapeVersion: probe.version,
        width,
      });
      await previewCache.removeExpired();
      const cached = await previewCache.get(cacheKey);
      const preview =
        cached === undefined
          ? await scratch.withDirectory("staging", async (directory) => {
              const nativeInput = await createNativeInputBundle(
                input.absolutePath,
                expectedRevision,
                directory,
                {
                  allowedRoot: input.workspaceRoot,
                  maxDependencyBytes: config.maxInputBytes,
                  maximumSanitizeMode: config.maximumSanitizeMode,
                },
              );
              const temporaryOutput = join(directory, "preview.png");
              const result = await runner.run(candidate.executablePath, {
                args: [
                  nativeInput.path,
                  "--export-type=png",
                  `--export-filename=${temporaryOutput}`,
                  ...normalizedArea.args,
                  "--export-background-opacity=0",
                  `--export-width=${width}`,
                  ...(height === undefined
                    ? []
                    : [`--export-height=${height}`]),
                ],
                cwd: directory,
                maxStderrBytes: config.maxStderrBytes,
                maxStdoutBytes: config.maxStdoutBytes,
                timeoutMs: config.processTimeoutMs,
              });
              if (
                result.exitCode !== 0 ||
                result.terminationReason !== "completed"
              )
                throw new Error("Inkscape preview render failed");
              const temporaryMetadata = await stat(temporaryOutput);
              if (temporaryMetadata.size > config.maxArtifactBytes)
                throw new Error(
                  "Preview exceeds configured artifact size limit",
                );
              const metadata = await verifyPng(temporaryOutput);
              if (
                metadata.width > PREVIEW_MAX_AXIS ||
                metadata.height > PREVIEW_MAX_AXIS
              )
                throw new Error("Preview exceeds configured dimension limit");
              await nativeInput.assertCurrent();
              await previewCache.put(
                cacheKey,
                temporaryOutput,
                metadata,
                PREVIEW_CACHE_TTL_MS,
              );
              return {
                bytes: await readFile(temporaryOutput),
                cache: "miss" as const,
                metadata,
              };
            })
          : {
              bytes: await readFile(cached.path),
              cache: "hit" as const,
              metadata: cached.metadata,
            };
      const committed = await fileStore.commit({
        contents: preview.bytes,
        ...(expectedOutputRevision === undefined
          ? {}
          : { expectedOutputRevision }),
        expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      await artifacts.removeExpired();
      const artifact = await artifacts.publish(
        output.absolutePath,
        workspaceId,
        24 * 60 * 60 * 1_000,
      );
      if (artifact.hash !== committed.revision)
        throw new Error("Preview output changed before artifact publication");
      const result = {
        area: normalizedArea.kind,
        artifact,
        cache: preview.cache,
        documentPath: output.relativePath,
        height: preview.metadata.height,
        inline: preview.bytes.byteLength <= config.maxInlineBytes,
        ...(normalizedArea.pageId === undefined
          ? {}
          : { pageId: normalizedArea.pageId }),
        revision: committed.revision,
        ...(normalizedArea.selectionId === undefined
          ? {}
          : { selectionId: normalizedArea.selectionId }),
        width: preview.metadata.width,
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(result) },
          ...(result.inline
            ? [
                {
                  data: preview.bytes.toString("base64"),
                  mimeType: "image/png",
                  type: "image" as const,
                },
              ]
            : []),
          ...(!result.inline
            ? [
                {
                  mimeType: "image/png",
                  name: "Preview PNG",
                  type: "resource_link" as const,
                  uri: artifact.uri,
                },
              ]
            : []),
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "document_export_batch",
    {
      description:
        "Renders a bounded batch of baseline PNG, PDF, SVG, or plain SVG variants. all_or_nothing verifies every variant before one logical publish; best_effort publishes verified successes.",
      inputSchema: z
        .object({
          mode: z.enum(["all_or_nothing", "best_effort"]),
          delivery: z.enum(["sync", "job"]).default("sync"),
          preset: exportPresetSchema.optional(),
          specs: z.array(exportSpecSchema).min(1).max(50).optional(),
          timeoutMs: z
            .number()
            .int()
            .min(1)
            .max(config.processTimeoutMs)
            .optional(),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict()
        .superRefine((value, context) => {
          if ((value.specs === undefined) === (value.preset === undefined))
            context.addIssue({
              code: "custom",
              message: "Provide exactly one of specs or preset",
              path: ["specs"],
            });
        }),
      outputSchema: z.union([
        z.object({
          failures: z.array(
            z.object({ index: z.number().int(), message: z.string() }),
          ),
          manifest: z.object({
            durationMs: z.number().int().nonnegative(),
            failures: z.array(
              z.object({ index: z.number().int(), message: z.string() }),
            ),
            inkscapeVersion: z.string().optional(),
            mode: z.enum(["all_or_nothing", "best_effort"]),
            publication: z.enum(["file_commit_batch", "file_commit_each"]),
            source: z.object({
              expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
              path: z.string(),
            }),
            variants: z.array(
              z.object({
                format: z.enum(["pdf", "plain-svg", "png", "svg"]),
                index: z.number().int(),
                outputPath: z.string(),
                revision: z.string().regex(/^[a-f0-9]{64}$/u),
              }),
            ),
          }),
          mode: z.enum(["all_or_nothing", "best_effort"]),
          successes: z.array(
            z.object({
              index: z.number().int(),
              outputPath: z.string(),
              revision: z.string().regex(/^[a-f0-9]{64}$/u),
            }),
          ),
        }),
        z.object({
          jobId: z.string().regex(/^job_[a-f0-9]{32}$/u),
          status: z.enum(["queued", "running"]),
        }),
      ]),
      annotations: { destructiveHint: false },
    },
    async ({ delivery, mode, preset, specs, timeoutMs, workspaceId }) => {
      const execute = async (execution?: {
        onProgress: (progress: { detail?: string; stage: string }) => void;
        signal: AbortSignal;
      }) => {
        if (execution?.signal.aborted)
          throw new Error("Export batch was cancelled");
        assertDocumentWorkspace(config);
        const startedAt = Date.now();
        const expandedSpecs =
          specs === undefined
            ? expandExportPreset(preset!)
            : specs.map(parseExportSpec);
        const variants = planExportBatch(expandedSpecs);
        if (preset !== undefined)
          await (
            await workspaces()
          ).ensureOutputDirectory(workspaceId, preset.outputDirectory);
        const source = variants[0]!.spec.source;
        if (
          variants.some(
            (variant) =>
              variant.spec.source.path !== source.path ||
              variant.spec.source.expectedRevision !== source.expectedRevision,
          )
        )
          throw new Error("Batch variants must share one source revision");
        if (variants.some((variant) => !isBaselineBatchSpec(variant.spec)))
          throw new Error(
            "Batch supports baseline PNG, PDF, SVG, and plain SVG variants only",
          );
        const workspace = await workspaces();
        const input = await workspace.resolveExisting(workspaceId, source.path);
        const outputs = await Promise.all(
          variants.map((variant) =>
            workspace.resolveNewOutput(workspaceId, variant.outputPath),
          ),
        );
        const staged = await executeExportBatch({
          mode,
          variants,
          execute: async (variant) => {
            execution?.onProgress({
              detail: `variant:${variant.index}`,
              stage: "rendering",
            });
            const rendered = await renderGenericExport({
              config,
              inputPath: input.absolutePath,
              inputRoot: input.workspaceRoot,
              runner,
              scratch,
              spec: variant.spec as Extract<
                ExportSpec,
                { format: "pdf" | "plain-svg" | "png" | "svg" }
              >,
              ...(timeoutMs === undefined ? {} : { timeoutMs }),
              ...(execution === undefined ? {} : { signal: execution.signal }),
            });
            return { ...rendered, variant };
          },
        });
        if (mode === "all_or_nothing" && staged.failures.length > 0)
          throw new Error(
            `Batch rendering failed at variant ${staged.failures[0]!.index}`,
          );
        const successes = [] as {
          index: number;
          outputPath: string;
          revision: string;
        }[];
        if (execution?.signal.aborted)
          throw new Error("Export batch was cancelled");
        execution?.onProgress({ stage: "publishing" });
        if (mode === "all_or_nothing") {
          const committed = await fileStore.commitBatch({
            expectedRevision: source.expectedRevision,
            files: staged.successes.map((stagedVariant) => {
              const target = fileExportTarget(stagedVariant.value.variant.spec);
              return {
                contents: stagedVariant.value.bytes,
                ...(target.expectedOutputRevision === undefined
                  ? {}
                  : { expectedOutputRevision: target.expectedOutputRevision }),
                targetPath: outputs[stagedVariant.index]!.absolutePath,
              };
            }),
            sourcePath: input.absolutePath,
          });
          for (let index = 0; index < staged.successes.length; index += 1)
            successes.push({
              index: staged.successes[index]!.index,
              outputPath: outputs[staged.successes[index]!.index]!.relativePath,
              revision: committed.files[index]!.revision,
            });
        } else
          for (const stagedVariant of staged.successes) {
            const output = outputs[stagedVariant.index]!;
            const target = fileExportTarget(stagedVariant.value.variant.spec);
            const committed = await fileStore.commit({
              contents: stagedVariant.value.bytes,
              ...(target.expectedOutputRevision === undefined
                ? {}
                : { expectedOutputRevision: target.expectedOutputRevision }),
              expectedRevision: source.expectedRevision,
              sourcePath: input.absolutePath,
              targetPath: output.absolutePath,
            });
            successes.push({
              index: stagedVariant.index,
              outputPath: output.relativePath,
              revision: committed.revision,
            });
          }
        const manifest = createExportBatchManifest({
          durationMs: Date.now() - startedAt,
          failures: staged.failures,
          ...(staged.successes[0] === undefined
            ? {}
            : { inkscapeVersion: staged.successes[0].value.inkscapeVersion }),
          mode,
          publication:
            mode === "all_or_nothing"
              ? "file_commit_batch"
              : "file_commit_each",
          source,
          variants: successes.map((success) => ({
            format: variants[success.index]!.format,
            index: success.index,
            outputPath: success.outputPath,
            revision: success.revision,
          })),
        });
        const result = { failures: staged.failures, manifest, mode, successes };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      };
      if (delivery === "job") {
        const job = jobs.create(workspaceId, async (options) => {
          const response = await execute(options);
          return response.structuredContent;
        });
        const result = { jobId: job.id, status: job.status };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      }
      return await execute();
    },
  );

  server.registerTool(
    "job_get",
    {
      description:
        "Returns the owner-bound status, latest monotonic progress and terminal batch result of an asynchronous export job.",
      inputSchema: z
        .object({
          jobId: z.string().regex(/^job_[a-f0-9]{32}$/u),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        error: z.string().optional(),
        id: z.string().regex(/^job_[a-f0-9]{32}$/u),
        progress: z
          .object({ detail: z.string().optional(), stage: z.string() })
          .optional(),
        result: z.unknown().optional(),
        status: z.enum([
          "cancelled",
          "completed",
          "failed",
          "queued",
          "running",
        ]),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ jobId, workspaceId }) => {
      const result = jobs.get(jobId, workspaceId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "job_cancel",
    {
      description:
        "Idempotently requests cancellation of an owner-bound asynchronous export job. No unfinished output is published.",
      inputSchema: z
        .object({
          jobId: z.string().regex(/^job_[a-f0-9]{32}$/u),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        error: z.string().optional(),
        id: z.string().regex(/^job_[a-f0-9]{32}$/u),
        progress: z
          .object({ detail: z.string().optional(), stage: z.string() })
          .optional(),
        result: z.unknown().optional(),
        status: z.enum([
          "cancelled",
          "completed",
          "failed",
          "queued",
          "running",
        ]),
      }),
      annotations: { destructiveHint: false },
    },
    async ({ jobId, workspaceId }) => {
      const result = jobs.cancel(jobId, workspaceId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "document_export",
    {
      description:
        "Exports one PNG, baseline PDF, SVG, or plain SVG from a validated ExportSpec through the bounded Inkscape pipeline. Use export_pdf for PDF-specific features and document_export_batch for variants.",
      inputSchema: z
        .object({
          spec: exportSpecSchema,
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        artifact: artifactSchema,
        format: z.enum(["pdf", "png", "plain-svg", "svg"]),
        outputPath: z.string().min(1).max(1024),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: false },
    },
    async ({ spec, workspaceId }) => {
      assertDocumentWorkspace(config);
      if (spec.target.kind !== "file")
        throw new Error(
          "document_export supports one file; use document_export_batch for variants",
        );
      if (
        spec.format !== "png" &&
        spec.format !== "pdf" &&
        spec.format !== "svg" &&
        spec.format !== "plain-svg"
      )
        throw new Error("Use the specialized export tool for this format");
      if (spec.format === "png" && spec.margin !== undefined)
        throw new Error("document_export does not yet support PNG margins");
      if (
        spec.format === "png" &&
        (spec.antialias !== undefined ||
          spec.colorMode !== undefined ||
          spec.compression !== undefined ||
          spec.dithering !== undefined ||
          spec.snapAreaToPixels !== undefined)
      )
        throw new Error("Use export_png for advanced PNG renderer options");
      if (
        (spec.format === "svg" || spec.format === "plain-svg") &&
        (spec.area.kind === "pages" || spec.resourcePolicy !== "preserve-local")
      )
        throw new Error("Use export_svg for this SVG export mode");
      if (
        spec.format === "pdf" &&
        (spec.area.kind === "pages" ||
          spec.filterRasterDpi !== undefined ||
          spec.filters !== "preserve" ||
          spec.latex === true ||
          spec.margin !== undefined ||
          spec.text !== "preserve" ||
          spec.version !== undefined)
      )
        throw new Error("Use export_pdf for advanced PDF export options");
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(
        workspaceId,
        spec.source.path,
      );
      const output = await workspace.resolveNewOutput(
        workspaceId,
        spec.target.path,
      );
      const expectedExtension =
        spec.format === "png"
          ? /\.png$/iu
          : spec.format === "pdf"
            ? /\.pdf$/iu
            : /\.svg$/iu;
      if (!expectedExtension.test(output.relativePath))
        throw new Error(
          "Output extension does not match the requested export format",
        );
      const source = await readFile(input.absolutePath, "utf8");
      const area = normalizeExportArea(
        spec.area.kind === "pages"
          ? { kind: "page", pageIds: spec.area.pageIds }
          : spec.area,
        listSvgPages(source),
      );
      if (area.selectionId !== undefined) {
        const selected = querySvgElementTargets(source, {
          ids: [area.selectionId],
          limit: 1,
          offset: 0,
        });
        if (selected.missingIds.length > 0)
          throw new Error("Export selection element does not exist");
      }
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const rendered = await scratch.withDirectory(
        "staging",
        async (directory) => {
          const nativeInput = await createNativeInputBundle(
            input.absolutePath,
            spec.source.expectedRevision,
            directory,
            {
              allowedRoot: input.workspaceRoot,
              maxDependencyBytes: config.maxInputBytes,
              maximumSanitizeMode: config.maximumSanitizeMode,
            },
          );
          const temporaryOutput = join(
            directory,
            spec.format === "png"
              ? "export.png"
              : spec.format === "pdf"
                ? "export.pdf"
                : "export.svg",
          );
          const background =
            spec.format === "png" && spec.background.mode === "document"
              ? inspectDocumentDisplaySettings(
                  await readFile(nativeInput.path, "utf8"),
                )
              : undefined;
          const run = await runner.run(candidate.executablePath, {
            args: [
              ...buildExportArgv({
                area,
                inputPath: nativeInput.path,
                outputPath: temporaryOutput,
                spec,
              }),
              ...(background === undefined
                ? []
                : [
                    `--export-background=${background.pageColor}`,
                    `--export-background-opacity=${background.pageOpacity}`,
                  ]),
            ],
            cwd: directory,
            maxStderrBytes: config.maxStderrBytes,
            maxStdoutBytes: config.maxStdoutBytes,
            timeoutMs: config.processTimeoutMs,
          });
          if (run.exitCode !== 0 || run.terminationReason !== "completed")
            throw new Error("Inkscape document export failed");
          await verifyExportArtifact(spec.format, temporaryOutput);
          await nativeInput.assertCurrent();
          return await readFile(temporaryOutput);
        },
      );
      const committed = await fileStore.commit({
        contents: rendered,
        ...(spec.target.expectedOutputRevision === undefined
          ? {}
          : { expectedOutputRevision: spec.target.expectedOutputRevision }),
        expectedRevision: spec.source.expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      await artifacts.removeExpired();
      const artifact = await artifacts.publish(
        output.absolutePath,
        workspaceId,
        24 * 60 * 60 * 1_000,
      );
      if (artifact.hash !== committed.revision)
        throw new Error("Export output changed before artifact publication");
      const result = {
        artifact,
        format: spec.format,
        outputPath: output.relativePath,
        revision: committed.revision,
        warnings: [],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "export_png",
    {
      description:
        "Exports an SVG document to PNG through Inkscape using only bounded, allowlisted options.",
      inputSchema: z
        .object({
          antialias: z.number().int().min(0).max(3).optional(),
          allowDistortion: z.boolean().default(false),
          area: z
            .enum(["custom", "drawing", "page", "selection"])
            .default("page"),
          background: z
            .enum(["document", "solid", "transparent"])
            .default("document"),
          backgroundColor: z
            .string()
            .regex(/^#[a-fA-F0-9]{6}$/u)
            .optional(),
          backgroundOpacity: z.number().finite().min(0).max(1).optional(),
          colorMode: z
            .enum([
              "Gray_1",
              "Gray_2",
              "Gray_4",
              "Gray_8",
              "Gray_16",
              "RGB_8",
              "RGB_16",
              "GrayAlpha_8",
              "GrayAlpha_16",
              "RGBA_8",
              "RGBA_16",
            ])
            .optional(),
          compression: z.number().int().min(0).max(9).optional(),
          customArea: z
            .object({
              height: z.number().finite().positive(),
              width: z.number().finite().positive(),
              x: z.number().finite(),
              y: z.number().finite(),
            })
            .strict()
            .optional(),
          expectedOutputRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          dpi: z.number().finite().positive().max(9_600).optional(),
          dithering: z.boolean().optional(),
          height: z.number().int().positive().max(100_000).optional(),
          outputPath: z.string().min(1).max(1024),
          pageId: shapeIdSchema.optional(),
          path: z.string().min(1).max(1024),
          selectionId: shapeIdSchema.optional(),
          snapAreaToPixels: z.boolean().optional(),
          width: z.number().int().positive().max(100_000).optional(),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .superRefine((value, context) => {
          if (value.area === "custom" && value.customArea === undefined)
            context.addIssue({
              code: "custom",
              message: "Custom PNG area requires customArea",
              path: ["customArea"],
            });
          if (value.area !== "custom" && value.customArea !== undefined)
            context.addIssue({
              code: "custom",
              message: "customArea is only valid for a custom PNG area",
              path: ["customArea"],
            });
          if (value.area === "selection" && value.selectionId === undefined)
            context.addIssue({
              code: "custom",
              message: "Selection PNG area requires selectionId",
              path: ["selectionId"],
            });
          if (value.area !== "selection" && value.selectionId !== undefined)
            context.addIssue({
              code: "custom",
              message: "selectionId is only valid for a selection PNG area",
              path: ["selectionId"],
            });
          if (value.area !== "page" && value.pageId !== undefined)
            context.addIssue({
              code: "custom",
              message: "pageId is only valid for a page PNG area",
              path: ["pageId"],
            });
          if (
            value.width !== undefined &&
            value.height !== undefined &&
            !value.allowDistortion
          )
            context.addIssue({
              code: "custom",
              message: "Exact PNG dimensions require allowDistortion=true",
              path: ["allowDistortion"],
            });
        }),
      outputSchema: z.object({
        area: z.enum(["custom", "drawing", "page", "selection"]),
        background: z.enum(["document", "solid", "transparent"]),
        bitDepth: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(4),
          z.literal(8),
          z.literal(16),
        ]),
        byteLength: z.number().int().positive(),
        colorType: z.union([
          z.literal(0),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(6),
        ]),
        dpiX: z.number().positive().optional(),
        dpiY: z.number().positive().optional(),
        height: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        pageId: shapeIdSchema.optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        selectionId: shapeIdSchema.optional(),
        width: z.number().int().positive(),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      antialias,
      allowDistortion,
      area,
      background,
      backgroundColor,
      backgroundOpacity,
      colorMode,
      compression,
      customArea,
      expectedOutputRevision,
      expectedRevision,
      dpi,
      dithering,
      height,
      outputPath,
      pageId,
      path,
      selectionId,
      snapAreaToPixels,
      width,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.png$/iu.test(output.relativePath))
        throw new Error("export_png requires a .png output path");
      if (dpi !== undefined && (width !== undefined || height !== undefined))
        throw new Error("PNG export accepts DPI or pixel dimensions, not both");
      if (background === "solid" && backgroundColor === undefined)
        throw new Error("Solid PNG background requires backgroundColor");
      if (background !== "solid" && backgroundColor !== undefined)
        throw new Error(
          "backgroundColor is only valid with a solid PNG background",
        );
      if (background !== "solid" && backgroundOpacity !== undefined)
        throw new Error(
          "backgroundOpacity is only valid with a solid PNG background",
        );
      const source = await readFile(input.absolutePath, "utf8");
      const exportArea =
        area === "custom"
          ? { kind: "custom" as const, rect: customArea! }
          : area === "selection"
            ? {
                elementIds: [selectionId!],
                kind: "selection" as const,
                output: "combined" as const,
                visibility: "document" as const,
              }
            : area === "page"
              ? {
                  kind: "page" as const,
                  ...(pageId === undefined ? {} : { pageIds: [pageId] }),
                }
              : { kind: "drawing" as const };
      const normalizedArea = normalizeExportArea(
        exportArea,
        listSvgPages(source),
      );
      if (normalizedArea.selectionId !== undefined) {
        const selection = querySvgElementTargets(source, {
          ids: [normalizedArea.selectionId],
          limit: 1,
          offset: 0,
        });
        if (selection.missingIds.length > 0)
          throw new Error("PNG selection element does not exist");
      }
      const pngSpec = parseExportSpec({
        ...(antialias === undefined ? {} : { antialias }),
        area: exportArea,
        background:
          background === "solid"
            ? {
                color: backgroundColor!,
                mode: "solid",
                opacity: backgroundOpacity ?? 1,
              }
            : { mode: background },
        ...(colorMode === undefined ? {} : { colorMode }),
        ...(compression === undefined ? {} : { compression }),
        ...(dithering === undefined ? {} : { dithering }),
        format: "png",
        ...(snapAreaToPixels === undefined ? {} : { snapAreaToPixels }),
        size:
          dpi !== undefined
            ? { dpi, mode: "dpi" }
            : width !== undefined && height !== undefined
              ? {
                  allowDistortion,
                  heightPx: height,
                  mode: "exact",
                  widthPx: width,
                }
              : width !== undefined
                ? { mode: "width", widthPx: width }
                : height !== undefined
                  ? { heightPx: height, mode: "height" }
                  : undefined,
        source: { expectedRevision, path },
        target: {
          ...(expectedOutputRevision === undefined
            ? {}
            : { expectedOutputRevision }),
          kind: "file",
          overwrite: expectedOutputRevision !== undefined,
          path: outputPath,
        },
      });
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const requiredCapabilities = requiredPngCapabilityFlags(pngSpec);
      if (requiredCapabilities.length > 0) {
        const observed = await capabilities.inspect(
          runner,
          candidate,
          probe.version,
          process.cwd(),
        );
        const available = new Set(
          observed.flags
            .filter((flag) => flag.availability === "available")
            .map((flag) => flag.name),
        );
        const unavailable = requiredCapabilities.filter(
          (flag) => !available.has(flag),
        );
        if (unavailable.length > 0)
          throw new Error(
            `Requested PNG renderer options are unavailable in this Inkscape installation: ${unavailable.map(pngCapabilityLabel).join(", ")}`,
          );
      }
      const png = await scratch.withDirectory("staging", async (directory) => {
        const nativeInput = await createNativeInputBundle(
          input.absolutePath,
          expectedRevision,
          directory,
          {
            allowedRoot: input.workspaceRoot,
            maxDependencyBytes: config.maxInputBytes,
            maximumSanitizeMode: config.maximumSanitizeMode,
          },
        );
        const displaySettings = inspectDocumentDisplaySettings(
          await readFile(nativeInput.path, "utf8"),
        );
        const backgroundArguments =
          background === "document"
            ? [
                `--export-background=${displaySettings.pageColor}`,
                `--export-background-opacity=${displaySettings.pageOpacity}`,
              ]
            : [];
        const temporaryOutput = join(directory, "export.png");
        const exportArgs = buildExportArgv({
          area: normalizedArea,
          inputPath: nativeInput.path,
          outputPath: temporaryOutput,
          spec: pngSpec,
        });
        const result = await runner.run(candidate.executablePath, {
          args: [...exportArgs, ...backgroundArguments],
          cwd: directory,
          maxStderrBytes: config.maxStderrBytes,
          maxStdoutBytes: config.maxStdoutBytes,
          timeoutMs: config.processTimeoutMs,
        });
        if (result.exitCode !== 0 || result.terminationReason !== "completed")
          throw new Error("Inkscape PNG export failed");
        const metadata = await verifyPng(temporaryOutput, {
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
        });
        await nativeInput.assertCurrent();
        return { bytes: await readFile(temporaryOutput), metadata };
      });
      const committed = await fileStore.commit({
        contents: png.bytes,
        ...(expectedOutputRevision === undefined
          ? {}
          : { expectedOutputRevision }),
        expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      const result = {
        ...png.metadata,
        area: normalizedArea.kind,
        background,
        ...(normalizedArea.pageId === undefined
          ? {}
          : { pageId: normalizedArea.pageId }),
        revision: committed.revision,
        ...(normalizedArea.selectionId === undefined
          ? {}
          : { selectionId: normalizedArea.selectionId }),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "export_pdf",
    {
      description:
        "Exports an SVG document to a validated PDF through Inkscape using bounded, allowlisted options.",
      inputSchema: z
        .object({
          expectedLatexOutputRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          expectedOutputRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          filterDpi: z.number().finite().positive().max(10_000).optional(),
          filters: z.enum(["ignore", "preserve"]).default("preserve"),
          latex: z.boolean().default(false),
          margin: pdfMarginSchema.optional(),
          outputPath: z.string().min(1).max(1024),
          pageIds: z
            .array(shapeIdSchema)
            .min(1)
            .max(100)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "PDF page IDs must be distinct",
            )
            .optional(),
          path: z.string().min(1).max(1024),
          pdfVersion: z.enum(["1.4", "1.5"]).optional(),
          textToPath: z.boolean().default(false),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict()
        .superRefine((value, context) => {
          if (value.expectedLatexOutputRevision !== undefined && !value.latex)
            context.addIssue({
              code: "custom",
              message: "expectedLatexOutputRevision requires latex=true",
              path: ["expectedLatexOutputRevision"],
            });
        }),
      outputSchema: z.object({
        byteLength: z.number().int().positive(),
        cropBoxes: z.array(
          z.object({
            height: z.number().positive(),
            width: z.number().positive(),
            x: z.number(),
            y: z.number(),
          }),
        ),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        latexSidecar: z
          .object({
            path: z.string().min(1).max(1028),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .optional(),
        mediaBoxes: z.array(
          z.object({
            height: z.number().positive(),
            width: z.number().positive(),
            x: z.number(),
            y: z.number(),
          }),
        ),
        pageCount: z.number().int().positive(),
        pageIds: z.array(shapeIdSchema).optional(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        strategy: z.enum(["full_document", "prune_subset"]),
        version: z.string().regex(/^1\.[0-9]$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      expectedLatexOutputRevision,
      expectedOutputRevision,
      expectedRevision,
      filterDpi,
      filters,
      latex,
      margin,
      outputPath,
      pageIds,
      path,
      pdfVersion,
      textToPath,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.pdf$/iu.test(output.relativePath))
        throw new Error("export_pdf requires a .pdf output path");
      const latexOutput = latex
        ? await workspace.resolveNewOutput(
            workspaceId,
            `${output.relativePath}_tex`,
          )
        : undefined;
      if (pageIds !== undefined) {
        const available = new Set(
          listSvgPages(await readFile(input.absolutePath, "utf8")).map(
            (page) => page.id,
          ),
        );
        if (pageIds.some((id) => !available.has(id)))
          throw new Error("Requested PDF subset page does not exist");
      }
      const pdfSpec = parseExportSpec({
        area:
          pageIds === undefined
            ? { kind: "document" }
            : { kind: "pages", pageIds },
        ...(filterDpi === undefined ? {} : { filterRasterDpi: filterDpi }),
        filters: filters === "ignore" ? "ignore-with-warning" : "preserve",
        format: "pdf",
        latex,
        ...(margin === undefined ? {} : { margin }),
        source: { expectedRevision, path },
        target: {
          ...(expectedOutputRevision === undefined
            ? {}
            : { expectedOutputRevision }),
          kind: "file",
          overwrite: expectedOutputRevision !== undefined,
          path: outputPath,
        },
        text: textToPath ? "paths" : "preserve",
        ...(pdfVersion === undefined ? {} : { version: pdfVersion }),
      });
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const requiredCapabilities = requiredPdfCapabilityFlags(pdfSpec);
      if (requiredCapabilities.length > 0) {
        const observed = await capabilities.inspect(
          runner,
          candidate,
          probe.version,
          process.cwd(),
        );
        const available = new Set(
          observed.flags
            .filter((flag) => flag.availability === "available")
            .map((flag) => flag.name),
        );
        const unavailable = requiredCapabilities.filter(
          (flag) => !available.has(flag),
        );
        if (unavailable.length > 0)
          throw new Error(
            `Requested PDF renderer options are unavailable in this Inkscape installation: ${unavailable.map(pdfCapabilityLabel).join(", ")}`,
          );
      }
      const pdf = await scratch.withDirectory("staging", async (directory) => {
        const nativeInput = await createNativeInputBundle(
          input.absolutePath,
          expectedRevision,
          directory,
          {
            allowedRoot: input.workspaceRoot,
            maxDependencyBytes: config.maxInputBytes,
            maximumSanitizeMode: config.maximumSanitizeMode,
          },
        );
        const nativeSource = await readFile(nativeInput.path, "utf8");
        let runnerSource =
          margin === undefined
            ? nativeSource
            : expandPdfMarginsSvg(nativeSource, margin, pageIds).svg;
        if (pageIds !== undefined)
          runnerSource = pruneSvgPagesForPdf(runnerSource, pageIds).svg;
        const runnerInputPath =
          runnerSource === nativeSource
            ? nativeInput.path
            : join(directory, "pdf-derived.svg");
        if (runnerInputPath !== nativeInput.path)
          await writeFile(runnerInputPath, runnerSource);
        const temporaryOutput = join(directory, "export.pdf");
        const result = await runner.run(candidate.executablePath, {
          args: buildExportArgv({
            area: normalizeExportArea({ kind: "document" }, []),
            inputPath: runnerInputPath,
            outputPath: temporaryOutput,
            spec: pdfSpec,
          }),
          cwd: directory,
          maxStderrBytes: config.maxStderrBytes,
          maxStdoutBytes: config.maxStdoutBytes,
          timeoutMs: config.processTimeoutMs,
        });
        if (result.exitCode !== 0 || result.terminationReason !== "completed")
          throw new Error("Inkscape PDF export failed");
        await nativeInput.assertCurrent();
        const metadata = await verifyPdf(temporaryOutput);
        if (pdfVersion !== undefined && metadata.version !== pdfVersion)
          throw new Error("Inkscape did not produce the requested PDF version");
        if (pageIds !== undefined && metadata.pageCount !== pageIds.length)
          throw new Error(
            "PDF subset did not preserve the requested page count",
          );
        let latexBytes: Buffer | undefined;
        if (latex) {
          try {
            latexBytes = await readFile(`${temporaryOutput}_tex`);
          } catch {
            throw new Error(
              "Inkscape did not produce the requested LaTeX sidecar",
            );
          }
        }
        return {
          bytes: await readFile(temporaryOutput),
          ...(latexBytes === undefined ? {} : { latexBytes }),
          metadata,
        };
      });
      const committedFiles = latex
        ? (
            await fileStore.commitBatch({
              expectedRevision,
              files: [
                {
                  contents: pdf.bytes,
                  ...(expectedOutputRevision === undefined
                    ? {}
                    : { expectedOutputRevision }),
                  targetPath: output.absolutePath,
                },
                {
                  contents: pdf.latexBytes!,
                  ...(expectedLatexOutputRevision === undefined
                    ? {}
                    : { expectedOutputRevision: expectedLatexOutputRevision }),
                  targetPath: latexOutput!.absolutePath,
                },
              ],
              sourcePath: input.absolutePath,
            })
          ).files
        : [
            await fileStore.commit({
              contents: pdf.bytes,
              ...(expectedOutputRevision === undefined
                ? {}
                : { expectedOutputRevision }),
              expectedRevision,
              sourcePath: input.absolutePath,
              targetPath: output.absolutePath,
            }),
          ];
      const committed = committedFiles[0]!;
      const result = {
        byteLength: pdf.metadata.byteLength,
        cropBoxes: pdf.metadata.cropBoxes,
        hash: pdf.metadata.hash,
        ...(latex
          ? {
              latexSidecar: {
                path: latexOutput!.relativePath,
                revision: committedFiles[1]!.revision,
              },
            }
          : {}),
        mediaBoxes: pdf.metadata.mediaBoxes,
        pageCount: pdf.metadata.pageCount,
        ...(pageIds === undefined ? {} : { pageIds }),
        revision: committed.revision,
        strategy: pageIds === undefined ? "full_document" : "prune_subset",
        version: pdf.metadata.version,
        warnings: [
          ...(pageIds === undefined ? [] : ["PDF_SUBSET_PRUNED"]),
          ...(filters === "ignore" ? ["FILTERS_IGNORED_VISUAL_CHANGE"] : []),
          ...(latex ? ["LATEX_SIDECAR_EMITTED"] : []),
          ...(margin === undefined ? [] : ["PDF_MARGIN_EXPANDED_TEMPORARY"]),
          ...(textToPath ? ["TEXT_CONVERTED_TO_PATHS"] : []),
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "export_pdf_pages",
    {
      description:
        "Exports explicit Inkscape pages as individually validated PDFs with stable page-NNN.pdf names.",
      inputSchema: z
        .object({
          expectedOutputRevisions: z
            .array(
              z
                .object({
                  expectedOutputRevision: z.string().regex(/^[a-f0-9]{64}$/u),
                  pageId: shapeIdSchema,
                })
                .strict(),
            )
            .max(100)
            .default([])
            .refine(
              (values) =>
                new Set(values.map((value) => value.pageId)).size ===
                values.length,
              "Output page revisions must be distinct",
            ),
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
          outputDirectory: z.string().min(1).max(1_000),
          pageIds: z
            .array(shapeIdSchema)
            .min(1)
            .max(100)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "PDF page IDs must be distinct",
            )
            .optional(),
          path: z.string().min(1).max(1024),
          workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
        })
        .strict(),
      outputSchema: z.object({
        pages: z.array(
          z.object({
            byteLength: z.number().int().positive(),
            cropBox: z.object({
              height: z.number().positive(),
              width: z.number().positive(),
              x: z.number(),
              y: z.number(),
            }),
            hash: z.string().regex(/^[a-f0-9]{64}$/u),
            mediaBox: z.object({
              height: z.number().positive(),
              width: z.number().positive(),
              x: z.number(),
              y: z.number(),
            }),
            outputPath: z.string().min(1).max(1_024),
            pageId: shapeIdSchema,
            pageIndex: z.number().int().positive(),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
            version: z.string().regex(/^1\.[0-9]$/u),
          }),
        ),
        strategy: z.literal("prune_each_page"),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      expectedOutputRevisions,
      expectedRevision,
      outputDirectory,
      pageIds,
      path,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const source = await readFile(input.absolutePath, "utf8");
      const pages = listSvgPages(source);
      if (pages.length === 0)
        throw new Error("PDF page export requires explicit Inkscape pages");
      const requestedIds = pageIds ?? pages.map((page) => page.id);
      const indexedPages = requestedIds.map((pageId) => {
        const pageIndex = pages.findIndex((page) => page.id === pageId);
        if (pageIndex < 0) throw new Error("Requested PDF page does not exist");
        return { pageId, pageIndex: pageIndex + 1 };
      });
      const requestedSet = new Set(requestedIds);
      if (
        expectedOutputRevisions.some(({ pageId }) => !requestedSet.has(pageId))
      )
        throw new Error("Output page revision references an unrequested page");
      const revisions = new Map(
        expectedOutputRevisions.map(({ expectedOutputRevision, pageId }) => [
          pageId,
          expectedOutputRevision,
        ]),
      );
      const outputs = await Promise.all(
        indexedPages.map(async ({ pageId, pageIndex }) => ({
          pageId,
          pageIndex,
          output: await workspace.resolveNewOutput(
            workspaceId,
            `${outputDirectory}/page-${String(pageIndex).padStart(3, "0")}.pdf`,
          ),
        })),
      );
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const pdfSpec = parseExportSpec({
        area: { kind: "document" },
        filters: "preserve",
        format: "pdf",
        source: { expectedRevision, path },
        target: {
          kind: "file",
          overwrite: false,
          path: outputs[0]!.output.relativePath,
        },
        text: "preserve",
      });
      const rendered = await scratch.withDirectory(
        "staging",
        async (directory) => {
          const nativeInput = await createNativeInputBundle(
            input.absolutePath,
            expectedRevision,
            directory,
            {
              allowedRoot: input.workspaceRoot,
              maxDependencyBytes: config.maxInputBytes,
              maximumSanitizeMode: config.maximumSanitizeMode,
            },
          );
          const nativeSource = await readFile(nativeInput.path, "utf8");
          const variants = [] as {
            bytes: Buffer;
            metadata: Awaited<ReturnType<typeof verifyPdf>>;
            pageId: string;
            pageIndex: number;
          }[];
          for (const { pageId, pageIndex } of outputs) {
            const variantInput = join(directory, `page-${pageIndex}.svg`);
            const temporaryOutput = join(directory, `page-${pageIndex}.pdf`);
            await writeFile(
              variantInput,
              pruneSvgPagesForPdf(nativeSource, [pageId]).svg,
            );
            const result = await runner.run(candidate.executablePath, {
              args: buildExportArgv({
                area: normalizeExportArea({ kind: "document" }, []),
                inputPath: variantInput,
                outputPath: temporaryOutput,
                spec: pdfSpec,
              }),
              cwd: directory,
              maxStderrBytes: config.maxStderrBytes,
              maxStdoutBytes: config.maxStdoutBytes,
              timeoutMs: config.processTimeoutMs,
            });
            if (
              result.exitCode !== 0 ||
              result.terminationReason !== "completed"
            )
              throw new Error("Inkscape separate PDF page export failed");
            const metadata = await verifyPdf(temporaryOutput);
            if (metadata.pageCount !== 1)
              throw new Error(
                "Separate PDF page export did not produce one page",
              );
            variants.push({
              bytes: await readFile(temporaryOutput),
              metadata,
              pageId,
              pageIndex,
            });
          }
          await nativeInput.assertCurrent();
          return variants;
        },
      );
      const committed = await fileStore.commitBatch({
        expectedRevision,
        files: rendered.map((variant, index) => ({
          contents: variant.bytes,
          ...(revisions.has(variant.pageId)
            ? { expectedOutputRevision: revisions.get(variant.pageId)! }
            : {}),
          targetPath: outputs[index]!.output.absolutePath,
        })),
        sourcePath: input.absolutePath,
      });
      const result = {
        pages: rendered.map((variant, index) => ({
          byteLength: variant.metadata.byteLength,
          cropBox: variant.metadata.cropBoxes[0]!,
          hash: variant.metadata.hash,
          mediaBox: variant.metadata.mediaBoxes[0]!,
          outputPath: outputs[index]!.output.relativePath,
          pageId: variant.pageId,
          pageIndex: variant.pageIndex,
          revision: committed.files[index]!.revision,
          version: variant.metadata.version,
        })),
        strategy: "prune_each_page" as const,
        warnings: ["PDF_PAGES_PRUNED_SEPARATELY"],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "export_svg",
    {
      description:
        "Exports an SVG as Inkscape SVG or plain SVG through the bounded Inkscape pipeline.",
      inputSchema: z.object({
        expectedOutputRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        flavor: z.enum(["inkscape", "plain"]),
        outputPath: z.string().min(1).max(1024),
        path: z.string().min(1).max(1024),
        selectionIds: z
          .array(shapeIdSchema)
          .min(1)
          .max(100)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "SVG selection IDs must be distinct",
          )
          .optional(),
        textToPath: z.boolean().default(false),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        assets: z.array(
          z.object({
            path: z.string().min(1).max(1024),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
          }),
        ),
        byteLength: z.number().int().positive(),
        flavor: z.enum(["inkscape", "plain"]),
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        viewBox: z.string().min(1).max(256),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      expectedOutputRevision,
      expectedRevision,
      flavor,
      outputPath,
      path,
      selectionIds,
      textToPath,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.svg$/iu.test(output.relativePath))
        throw new Error("export_svg requires a .svg output path");
      const discovery = await locateInkscape({
        config,
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates[0];
      if (!candidate) throw new Error("Inkscape executable is unavailable");
      const probe = await probeInkscapeCandidate(
        runner,
        candidate,
        process.cwd(),
      );
      if (!("version" in probe))
        throw new Error("Inkscape executable could not be validated");
      const svgSpec = parseExportSpec({
        area: { kind: "document" },
        format: flavor === "plain" ? "plain-svg" : "svg",
        resourcePolicy: "preserve-local",
        source: { expectedRevision, path },
        target: {
          ...(expectedOutputRevision === undefined
            ? {}
            : { expectedOutputRevision }),
          kind: "file",
          overwrite: expectedOutputRevision !== undefined,
          path: outputPath,
        },
        text: textToPath ? "paths" : "preserve",
      });
      const svg = await scratch.withDirectory("staging", async (directory) => {
        const nativeInput = await createNativeInputBundle(
          input.absolutePath,
          expectedRevision,
          directory,
          {
            allowedRoot: input.workspaceRoot,
            maxDependencyBytes: config.maxInputBytes,
            maximumSanitizeMode: config.maximumSanitizeMode,
          },
        );
        const selection =
          selectionIds === undefined
            ? undefined
            : extractSvgSelection(
                await readFile(nativeInput.path, "utf8"),
                selectionIds,
              );
        const runnerInputPath =
          selection === undefined
            ? nativeInput.path
            : join(directory, "selection.svg");
        if (selection !== undefined)
          await writeFile(runnerInputPath, selection.svg);
        const temporaryOutput = join(directory, "export.svg");
        const run = await runner.run(candidate.executablePath, {
          args: buildExportArgv({
            area: normalizeExportArea({ kind: "document" }, []),
            inputPath: runnerInputPath,
            outputPath: temporaryOutput,
            spec: svgSpec,
          }),
          cwd: directory,
          maxStderrBytes: config.maxStderrBytes,
          maxStdoutBytes: config.maxStdoutBytes,
          timeoutMs: config.processTimeoutMs,
        });
        if (run.exitCode !== 0 || run.terminationReason !== "completed")
          throw new Error("Inkscape SVG export failed");
        const assetDirectoryName = `${basename(output.relativePath)}.assets`;
        let bytes = await readFile(temporaryOutput);
        const assets =
          selection === undefined
            ? []
            : await Promise.all(
                nativeInput.manifest.dependencies
                  .filter((dependency) =>
                    bytes.toString("utf8").includes(dependency.path),
                  )
                  .map(async (dependency) => ({
                    bytes: await readFile(join(directory, dependency.path)),
                    outputPath: `${assetDirectoryName}/${basename(dependency.path)}`,
                    stagedPath: dependency.path,
                  })),
              );
        if (assets.length > 0) {
          const replacements = new Map(
            assets.map((asset) => [asset.stagedPath, asset.outputPath]),
          );
          bytes = Buffer.from(
            rewriteStagedAssetReferences(bytes.toString("utf8"), replacements),
            "utf8",
          );
          await writeFile(temporaryOutput, bytes);
        }
        const metadata = await verifySvg(temporaryOutput);
        await nativeInput.assertCurrent();
        return {
          assets,
          bytes,
          metadata,
          warnings:
            selection === undefined
              ? []
              : ["SELECTION_EXTRACTED_AUTONOMOUSLY", ...selection.warnings],
        };
      });
      const assetDirectory = join(
        dirname(output.absolutePath),
        `${basename(output.absolutePath)}.assets`,
      );
      const publication =
        svg.assets.length === 0
          ? {
              assets: [],
              revision: (
                await fileStore.commit({
                  contents: svg.bytes,
                  ...(expectedOutputRevision === undefined
                    ? {}
                    : { expectedOutputRevision }),
                  expectedRevision,
                  sourcePath: input.absolutePath,
                  targetPath: output.absolutePath,
                })
              ).revision,
            }
          : await publishSelectionSvgWithAssets({
              assetDirectory,
              assets: svg.assets,
              ...(expectedOutputRevision === undefined
                ? {}
                : { expectedOutputRevision }),
              expectedRevision,
              fileStore,
              inputPath: input.absolutePath,
              outputPath: output.absolutePath,
              svg: svg.bytes,
            });
      const result = {
        assets:
          svg.assets.length === 0
            ? []
            : publication.assets.map((asset) => ({
                path: asset.path,
                revision: asset.revision,
              })),
        byteLength: svg.metadata.byteLength,
        flavor,
        hash: svg.metadata.hash,
        revision: publication.revision,
        viewBox: svg.metadata.viewBox,
        warnings: [
          ...svg.warnings,
          ...(textToPath ? ["TEXT_CONVERTED_TO_PATHS"] : []),
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

type SelectionPublishedAsset = {
  bytes: Uint8Array;
  outputPath: string;
  stagedPath: string;
};

async function publishSelectionSvgWithAssets(args: {
  assetDirectory: string;
  assets: readonly SelectionPublishedAsset[];
  expectedOutputRevision?: string;
  expectedRevision: string;
  fileStore: AtomicFileStore;
  inputPath: string;
  outputPath: string;
  svg: Uint8Array;
}): Promise<{
  assets: readonly { path: string; revision: string }[];
  revision: string;
}> {
  if (args.assets.length > 99)
    throw new Error("Selection export has too many local assets");
  try {
    await mkdir(args.assetDirectory);
  } catch {
    throw new Error(
      "Selection asset directory already exists or cannot be created",
    );
  }
  try {
    const committed = await args.fileStore.commitBatch({
      expectedRevision: args.expectedRevision,
      files: [
        {
          contents: args.svg,
          ...(args.expectedOutputRevision === undefined
            ? {}
            : { expectedOutputRevision: args.expectedOutputRevision }),
          targetPath: args.outputPath,
        },
        ...args.assets.map((asset) => ({
          contents: asset.bytes,
          targetPath: join(args.assetDirectory, basename(asset.outputPath)),
        })),
      ],
      sourcePath: args.inputPath,
    });
    return {
      assets: committed.files.slice(1).map((file, index) => ({
        path: args.assets[index]!.outputPath,
        revision: file.revision,
      })),
      revision: committed.files[0]!.revision,
    };
  } catch (error) {
    await rmdir(args.assetDirectory).catch(() => undefined);
    throw error;
  }
}

function fileExportTarget(
  spec: ExportSpec,
): Extract<ExportSpec["target"], { kind: "file" }> {
  if (spec.target.kind !== "file")
    throw new Error("Batch variants require a file target");
  return spec.target;
}

function isBaselineBatchSpec(
  spec: ExportSpec,
): spec is Extract<
  ExportSpec,
  { format: "pdf" | "plain-svg" | "png" | "svg" }
> {
  if (spec.target.kind !== "file") return false;
  if (spec.format === "png")
    return (
      spec.margin === undefined &&
      spec.antialias === undefined &&
      spec.colorMode === undefined &&
      spec.compression === undefined &&
      spec.dithering === undefined &&
      spec.snapAreaToPixels === undefined
    );
  if (spec.format === "pdf")
    return (
      spec.area.kind !== "pages" &&
      spec.filterRasterDpi === undefined &&
      spec.filters === "preserve" &&
      spec.latex !== true &&
      spec.margin === undefined &&
      spec.text === "preserve" &&
      spec.version === undefined
    );
  return (
    (spec.format === "svg" || spec.format === "plain-svg") &&
    spec.area.kind !== "pages" &&
    spec.resourcePolicy === "preserve-local"
  );
}

async function renderGenericExport(request: {
  config: ServerConfig;
  inputPath: string;
  inputRoot: string;
  runner: ProcessRunner;
  scratch: ScratchManager;
  signal?: AbortSignal;
  spec: Extract<ExportSpec, { format: "pdf" | "plain-svg" | "png" | "svg" }>;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; inkscapeVersion: string }> {
  const source = await readFile(request.inputPath, "utf8");
  const area = normalizeExportArea(
    request.spec.area.kind === "pages"
      ? { kind: "page", pageIds: request.spec.area.pageIds }
      : request.spec.area,
    listSvgPages(source),
  );
  if (area.selectionId !== undefined) {
    const selected = querySvgElementTargets(source, {
      ids: [area.selectionId],
      limit: 1,
      offset: 0,
    });
    if (selected.missingIds.length > 0)
      throw new Error("Export selection element does not exist");
  }
  const discovery = await locateInkscape({
    config: request.config,
    cwd: process.cwd(),
    runner: request.runner,
  });
  const candidate = discovery.candidates[0];
  if (!candidate) throw new Error("Inkscape executable is unavailable");
  const probe = await probeInkscapeCandidate(
    request.runner,
    candidate,
    process.cwd(),
  );
  if (!("version" in probe))
    throw new Error("Inkscape executable could not be validated");
  return request.scratch.withDirectory("staging", async (directory) => {
    const nativeInput = await createNativeInputBundle(
      request.inputPath,
      request.spec.source.expectedRevision,
      directory,
      {
        allowedRoot: request.inputRoot,
        maxDependencyBytes: request.config.maxInputBytes,
        maximumSanitizeMode: request.config.maximumSanitizeMode,
      },
    );
    const temporaryOutput = join(
      directory,
      request.spec.format === "png"
        ? "export.png"
        : request.spec.format === "pdf"
          ? "export.pdf"
          : "export.svg",
    );
    const background =
      request.spec.format === "png" &&
      request.spec.background.mode === "document"
        ? inspectDocumentDisplaySettings(
            await readFile(nativeInput.path, "utf8"),
          )
        : undefined;
    const run = await request.runner.run(candidate.executablePath, {
      args: [
        ...buildExportArgv({
          area,
          inputPath: nativeInput.path,
          outputPath: temporaryOutput,
          spec: request.spec,
        }),
        ...(background === undefined
          ? []
          : [
              `--export-background=${background.pageColor}`,
              `--export-background-opacity=${background.pageOpacity}`,
            ]),
      ],
      cwd: directory,
      maxStderrBytes: request.config.maxStderrBytes,
      maxStdoutBytes: request.config.maxStdoutBytes,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      timeoutMs: request.timeoutMs ?? request.config.processTimeoutMs,
    });
    if (run.exitCode !== 0 || run.terminationReason !== "completed")
      throw new Error("Inkscape document export failed");
    await verifyExportArtifact(request.spec.format, temporaryOutput);
    await nativeInput.assertCurrent();
    return {
      bytes: await readFile(temporaryOutput),
      inkscapeVersion: probe.version,
    };
  });
}

async function discoverSystemFontFamilies(
  runner: ProcessRunner,
): Promise<{ families: readonly string[]; source: string }> {
  const isWindows = process.platform === "win32";
  const result = await runner.run(isWindows ? "powershell.exe" : "fc-list", {
    args: isWindows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
        ]
      : ["--format=%{family}\n"],
    cwd: process.cwd(),
    maxStderrBytes: 64 * 1024,
    maxStdoutBytes: 512 * 1024,
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0 || result.terminationReason !== "completed")
    throw new Error("Local font discovery failed");
  const families = normalizeFontFamilies(
    result.stdout
      .toString("utf8")
      .split(/\r?\n/u)
      .flatMap((line) => line.split(",")),
  );
  if (families.length > 5_000)
    throw new Error("Local font inventory exceeded the safety limit");
  return {
    families,
    source: isWindows ? "windows-installed-font-collection" : "fontconfig",
  };
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

/**
 * Conservative, deterministic work units for clients to budget a transaction.
 * It is not a timing promise: SVG complexity and native rendering are excluded.
 */
function estimateDesignOperationCost(
  operations: readonly DesignOperation[],
): number {
  return operations.reduce((total, operation) => {
    switch (operation.kind) {
      case "create":
      case "update":
        return total + operation.elements.length;
      case "transform":
      case "reparent":
      case "delete":
        return total + operation.ids.length;
      case "arrange":
        return total + operation.request.ids.length;
      case "group":
        return (
          total +
          (operation.request.action === "group"
            ? operation.request.ids.length
            : 1)
        );
      case "duplicate":
        return total + 1;
    }
  }, 0);
}

function resolveTransactionReferences(
  references: readonly string[],
  aliases: ReadonlyMap<string, string>,
): string[] {
  return references.map((reference) =>
    resolveTransactionReference(reference, aliases),
  );
}

function resolveTransactionReference(
  reference: string,
  aliases: ReadonlyMap<string, string>,
): string {
  if (!reference.startsWith("@")) return reference;
  const resolved = aliases.get(reference.slice(1));
  if (resolved === undefined)
    throw new Error("Transaction alias is not defined");
  return resolved;
}

function resolveTransactionElementUpdates(
  updates: readonly z.infer<typeof transactionElementUpdateSchema>[],
  aliases: ReadonlyMap<string, string>,
): Parameters<typeof updateSvgShapes>[1] {
  return updates.map(({ id, ...update }) => ({
    ...update,
    id: resolveTransactionReference(id, aliases),
  }));
}

function registerTransactionAlias(
  aliases: Map<string, string>,
  alias: string,
  id: string,
): void {
  if (aliases.has(alias))
    throw new Error("Transaction alias is already defined");
  aliases.set(alias, id);
}

/** Resolves public image requests before the DOM-only shape constructor runs. */
async function prepareShapeSpecs(
  elements: readonly ShapeRequest[],
  document: ResolvedWorkspacePath,
  workspace: WorkspaceService,
  config: ServerConfig,
): Promise<ShapeSpec[]> {
  const prepared: ShapeSpec[] = [];
  for (const element of elements) {
    if (element.kind !== "image") {
      prepared.push(element);
      continue;
    }
    const asset = await workspace.resolveExisting(
      document.workspaceId,
      element.assetPath,
    );
    const metadata = await stat(asset.absolutePath);
    if (metadata.size > config.maxInputBytes)
      throw new Error("Image asset exceeds the configured size limit");
    const bytes = await readFile(asset.absolutePath);
    const mime = sniffRasterMime(bytes);
    const href =
      element.embedding === "embed"
        ? `data:${mime};base64,${bytes.toString("base64")}`
        : relative(
            dirname(document.absolutePath),
            asset.absolutePath,
          ).replaceAll("\\", "/");
    if (!href || href.startsWith("/"))
      throw new Error("Image asset must resolve to a local relative resource");
    prepared.push({
      ...(element.id === undefined ? {} : { id: element.id }),
      ...(element.parentId === undefined ? {} : { parentId: element.parentId }),
      ...(element.preserveAspectRatio === undefined
        ? {}
        : { preserveAspectRatio: element.preserveAspectRatio }),
      ...(element.style === undefined ? {} : { style: element.style }),
      height: element.height,
      href,
      kind: "image",
      width: element.width,
      x: element.x,
      y: element.y,
    });
  }
  return prepared;
}

function sniffRasterMime(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF(?:87a|89a)$/u)
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new Error("Image asset is not a supported raster format");
}

async function artifactResource(
  artifacts: ArtifactStore,
  id: string | undefined,
  offset: number,
  uri: string,
  maximumReadBytes: number,
): Promise<{
  contents: Array<{ blob: string; mimeType: string; uri: string }>;
}> {
  if (id === undefined || !/^art_[a-f0-9]{32}$/u.test(id))
    throw new Error("Artifact URI is invalid");
  await artifacts.removeExpired();
  const chunk = await artifacts.readCapabilityChunk(
    id,
    offset,
    maximumReadBytes,
    maximumReadBytes,
  );
  return {
    contents: [
      {
        blob: chunk.bytes.toString("base64"),
        mimeType: "application/octet-stream",
        uri,
      },
    ],
  };
}

function parseArtifactOffset(value: string | undefined): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,15})$/u.test(value))
    throw new Error("Artifact chunk offset is invalid");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset))
    throw new Error("Artifact chunk offset is invalid");
  return offset;
}

function resourceVariable(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function previewCacheKey(request: {
  area: {
    args: readonly string[];
    kind: "custom" | "document" | "drawing" | "page" | "selection";
    pageId?: string | undefined;
    selectionId?: string | undefined;
  };
  expectedRevision: string;
  height?: number | undefined;
  inkscapeVersion: string;
  width: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        area: request.area,
        expectedRevision: request.expectedRevision,
        height: request.height ?? null,
        inkscapeVersion: request.inkscapeVersion,
        transparentBackground: true,
        width: request.width,
      }),
    )
    .digest("hex");
}

function inventoryVisualBounds(
  boundsById: ReadonlyMap<string, InkscapeBounds>,
  pages: readonly {
    height: number;
    id: string;
    width: number;
    x: number;
    y: number;
  }[],
): {
  fidelity: "partial";
  global?: InkscapeBounds;
  limitations: readonly ["GEOMETRIC_ENGINE_UNAVAILABLE"];
  pages: readonly { bounds?: InkscapeBounds; id: string }[];
  source: "inkscape-query-all";
} {
  const bounds = [...boundsById.values()].filter(
    (value) => value.width > 0 && value.height > 0,
  );
  return {
    fidelity: nativeVisualBounds.fidelity,
    ...(unionAvailableBounds(bounds) === undefined
      ? {}
      : { global: unionAvailableBounds(bounds)! }),
    limitations: nativeVisualBounds.limitations,
    pages: pages.map((page) => {
      const inPage = bounds
        .map((bound) => intersectBounds(bound, page))
        .filter((bound): bound is InkscapeBounds => bound !== undefined);
      const pageBounds = unionAvailableBounds(inPage);
      return pageBounds === undefined
        ? { id: page.id }
        : { bounds: pageBounds, id: page.id };
    }),
    source: nativeVisualBounds.source,
  };
}

function unionAvailableBounds(
  bounds: readonly InkscapeBounds[],
): InkscapeBounds | undefined {
  if (bounds.length === 0) return undefined;
  return unionBounds(bounds);
}

function intersectBounds(
  left: InkscapeBounds,
  right: InkscapeBounds,
): InkscapeBounds | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return undefined;
  return { height: bottomEdge - y, width: rightEdge - x, x, y };
}

function unionBounds(bounds: readonly InkscapeBounds[]): InkscapeBounds {
  const first = bounds[0];
  if (!first) throw new Error("No native visual bounds are available for fit");
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const bound of bounds.slice(1)) {
    left = Math.min(left, bound.x);
    top = Math.min(top, bound.y);
    right = Math.max(right, bound.x + bound.width);
    bottom = Math.max(bottom, bound.y + bound.height);
  }
  if (right <= left || bottom <= top)
    throw new Error("Native visual bounds have no positive area");
  return { height: bottom - top, width: right - left, x: left, y: top };
}

function requireLayoutBounds(
  ids: readonly string[],
  nativeBounds: ReadonlyMap<string, InkscapeBounds>,
): LayoutBounds[] {
  if (new Set(ids).size !== ids.length)
    throw new Error("Layout IDs must be unique");
  return ids.map((id) => {
    const bounds = nativeBounds.get(id);
    if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0)
      throw new Error(
        "Inkscape did not return positive visual bounds for a layout ID",
      );
    return { id, ...bounds };
  });
}

function resolveLayoutAnchor(
  anchor: z.infer<typeof layoutAnchorSchema>,
  source: string,
  selected: readonly LayoutBounds[],
  nativeBounds: ReadonlyMap<string, InkscapeBounds>,
): LayoutReference {
  switch (anchor.kind) {
    case "selection":
      return unionLayoutBounds(selected);
    case "coordinate":
      return { height: 0, width: 0, x: anchor.x, y: anchor.y };
    case "element": {
      const bounds = requireLayoutBounds([anchor.id], nativeBounds)[0]!;
      return bounds;
    }
    case "page": {
      const pages = listSvgPages(source);
      if (pages.length === 0) return inspectSvgSettings(source).viewBox;
      if (anchor.pageId === undefined && pages.length !== 1)
        throw new Error(
          "A page anchor requires pageId when the document has multiple pages",
        );
      const page =
        anchor.pageId === undefined
          ? pages[0]
          : pages.find((candidate) => candidate.id === anchor.pageId);
      if (!page) throw new Error("Layout page anchor does not exist");
      return page;
    }
  }
}

function applyLayoutMoves(
  source: string,
  moves: readonly LayoutMove[],
): string {
  let changed = source;
  for (const move of moves) {
    if (move.x === 0 && move.y === 0) continue;
    changed = transformSvgShapes(changed, [move.id], {
      kind: "translate",
      x: move.x,
      y: move.y,
    }).svg;
  }
  return changed;
}

function assertNoNestedLayoutSelection(
  source: string,
  ids: readonly string[],
): void {
  if (new Set(ids).size !== ids.length)
    throw new Error("Layout IDs must be unique");
  const catalog = querySvgElementTargets(source, {
    limit: 1_000,
    offset: 0,
  });
  if (catalog.total > catalog.elements.length)
    throw new Error(
      "Layout cannot validate nesting in a document with over 1,000 elements",
    );
  const parentById = new Map(
    catalog.elements.flatMap(({ summary }) =>
      summary.id === undefined ? [] : [[summary.id, summary.parentId] as const],
    ),
  );
  const selected = new Set(ids);
  for (const id of ids) {
    let parentId = parentById.get(id);
    while (parentId !== undefined) {
      if (selected.has(parentId))
        throw new Error(
          "Layout cannot select an ancestor and descendant together",
        );
      parentId = parentById.get(parentId);
    }
  }
}

async function runNativePathBoolean(request: {
  config: ServerConfig;
  document: ResolvedWorkspacePath;
  expectedRevision: string;
  ids: readonly [string, string] | readonly string[];
  operation: "difference" | "exclusion" | "intersection" | "union";
  runner: ProcessRunner;
  scratch: ScratchManager;
}): Promise<string> {
  const discovery = await locateInkscape({
    config: request.config,
    cwd: process.cwd(),
    runner: request.runner,
  });
  const candidate = discovery.candidates[0];
  if (!candidate) throw new Error("Inkscape executable is unavailable");
  const probe = await probeInkscapeCandidate(
    request.runner,
    candidate,
    process.cwd(),
  );
  if (!("version" in probe))
    throw new Error("Inkscape executable could not be validated");
  return request.scratch.withDirectory("staging", async (directory) => {
    const nativeInput = await createNativeInputBundle(
      request.document.absolutePath,
      request.expectedRevision,
      directory,
      {
        allowedRoot: request.document.workspaceRoot,
        maxDependencyBytes: request.config.maxInputBytes,
        maximumSanitizeMode: request.config.maximumSanitizeMode,
      },
    );
    const outputPath = join(directory, "result.svg");
    const actions = [
      `select-by-id:${request.ids.join(",")}`,
      `path-${request.operation}`,
      `export-filename:${outputPath}`,
      "export-plain-svg",
      "export-do",
    ].join(";");
    const run = await request.runner.run(candidate.executablePath, {
      args: [nativeInput.path, `--actions=${actions}`],
      cwd: directory,
      maxStderrBytes: request.config.maxStderrBytes,
      maxStdoutBytes: request.config.maxStdoutBytes,
      timeoutMs: request.config.processTimeoutMs,
    });
    if (run.exitCode !== 0 || run.terminationReason !== "completed")
      throw new Error("Inkscape path boolean operation failed");
    const exported = await readFile(outputPath, "utf8");
    const sanitized = sanitizeSvg(exported, {
      maxElements: 100_000,
      maxInputBytes: request.config.maxInputBytes,
      mode: request.config.maximumSanitizeMode,
    });
    if (sanitized.removed.length > 0)
      throw new Error(
        "Inkscape path boolean result did not meet SVG safety policy",
      );
    await nativeInput.assertCurrent();
    return sanitized.svg;
  });
}

async function queryNativeBounds(request: {
  config: ServerConfig;
  documentPath: string;
  expectedRevision: string;
  runner: ProcessRunner;
  scratch: ScratchManager;
  workspaceRoot: string;
}): Promise<ReadonlyMap<string, InkscapeBounds>> {
  const discovery = await locateInkscape({
    config: request.config,
    cwd: process.cwd(),
    runner: request.runner,
  });
  const candidate = discovery.candidates[0];
  if (!candidate) throw new Error("Inkscape executable is unavailable");
  const probe = await probeInkscapeCandidate(
    request.runner,
    candidate,
    process.cwd(),
  );
  if (!("version" in probe))
    throw new Error("Inkscape executable could not be validated");
  return request.scratch.withDirectory("staging", async (directory) => {
    const nativeInput = await createNativeInputBundle(
      request.documentPath,
      request.expectedRevision,
      directory,
      {
        allowedRoot: request.workspaceRoot,
        maxDependencyBytes: request.config.maxInputBytes,
        maximumSanitizeMode: request.config.maximumSanitizeMode,
      },
    );
    const remapped = remapSvgIdsForNativeQuery(
      await readFile(nativeInput.path, "utf8"),
    );
    const queryInputPath = join(directory, "query.svg");
    await writeFile(queryInputPath, remapped.svg, "utf8");
    const result = await request.runner.run(candidate.executablePath, {
      args: [queryInputPath, "--query-all"],
      cwd: directory,
      maxStderrBytes: request.config.maxStderrBytes,
      maxStdoutBytes: request.config.maxStdoutBytes,
      timeoutMs: request.config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed")
      throw new Error("Inkscape bounds query failed");
    await nativeInput.assertCurrent();
    return new Map(
      [...parseInkscapeQueryAll(result.stdout.toString("utf8"))].flatMap(
        ([nativeId, bounds]) => {
          const originalId = remapped.originalIdByNativeId.get(nativeId);
          return originalId === undefined
            ? []
            : [[originalId, bounds] as const];
        },
      ),
    );
  });
}
