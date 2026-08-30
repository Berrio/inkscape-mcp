import { z } from "zod";

const MAX_DPI = 10_000;
const MAX_SELECTION_IDS = 100;
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const SAFE_RELATIVE_PATH =
  /^(?![\\/]|[A-Za-z]:)(?!.*(?:^|[\\/])\.\.?[\\/])[^<>:"|?*]+$/u;
const SAFE_TEMPLATE_TOKEN = /\{(?:format|id|index|page)\}/gu;

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      SAFE_RELATIVE_PATH.test(value) &&
      value
        .split(/[\\/]/u)
        .every((part) => part.length > 0 && part !== "." && part !== "..") &&
      !hasControlCharacters(value),
    "Output path is unsafe",
  );
const elementIdSchema = z
  .string()
  .regex(SAFE_ID, "Element ID is invalid for export");
const pageIdSchema = z.string().min(1).max(128);
const viewportLengthSchema = z.object({
  unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
  value: z.number().finite().nonnegative(),
});
const edgeInsetsSchema = z
  .object({
    bottom: viewportLengthSchema,
    left: viewportLengthSchema,
    right: viewportLengthSchema,
    top: viewportLengthSchema,
  })
  .strict();
const userRectSchema = z
  .object({
    height: z.number().finite().positive(),
    width: z.number().finite().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();
const selectionAreaSchema = z
  .object({
    elementIds: z.array(elementIdSchema).min(1).max(MAX_SELECTION_IDS),
    kind: z.literal("selection"),
    output: z.enum(["combined", "each"]),
    visibility: z.enum(["document", "selected-only"]),
  })
  .strict()
  .refine(
    (value) => new Set(value.elementIds).size === value.elementIds.length,
    "Selection IDs must be distinct",
  );
const pngAreaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("drawing") }).strict(),
  z
    .object({
      kind: z.literal("page"),
      pageIds: z.array(pageIdSchema).min(1).max(100).optional(),
    })
    .strict(),
  selectionAreaSchema,
  z.object({ kind: z.literal("custom"), rect: userRectSchema }).strict(),
]);
const vectorAreaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document") }).strict(),
  z.object({ kind: z.literal("drawing") }).strict(),
  z
    .object({
      kind: z.literal("pages"),
      pageIds: z.array(pageIdSchema).min(1).max(100),
    })
    .strict(),
  selectionAreaSchema,
]);
const outputTargetSchema = z
  .object({
    expectedOutputRevision: revisionSchema.optional(),
    kind: z.literal("file"),
    overwrite: z.boolean().default(false),
    path: relativePathSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.overwrite && value.expectedOutputRevision === undefined)
      context.addIssue({
        code: "custom",
        message: "Overwriting an export requires expectedOutputRevision",
        path: ["expectedOutputRevision"],
      });
    if (!value.overwrite && value.expectedOutputRevision !== undefined)
      context.addIssue({
        code: "custom",
        message: "expectedOutputRevision requires overwrite=true",
        path: ["expectedOutputRevision"],
      });
  });
const outputTemplateSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    const normalized = value.replace(SAFE_TEMPLATE_TOKEN, "token");
    return SAFE_RELATIVE_PATH.test(normalized) && !/[{}]/u.test(normalized);
  }, "Output template is unsafe or has an unsupported token");
const multiOutputTargetSchema = z
  .object({
    directory: relativePathSchema,
    kind: z.literal("directory"),
    strategy: z.enum(["directory_rename", "manifest_commit"]),
    template: outputTemplateSchema,
  })
  .strict();
const sourceSchema = z
  .object({ expectedRevision: revisionSchema, path: relativePathSchema })
  .strict();
export const exportPresetSchema = z
  .object({
    name: z.enum([
      "print-a4-pdf",
      "print-pdf-300dpi",
      "web-png",
      "web-asset-pack",
      "plain-svg",
      "icon-pack",
    ]),
    outputDirectory: relativePathSchema,
    source: sourceSchema,
  })
  .strict();
const commonExportSchema = z.object({
  source: sourceSchema,
  target: z.union([outputTargetSchema, multiOutputTargetSchema]),
});
const pngSizeSchema = z.discriminatedUnion("mode", [
  z
    .object({
      dpi: z.number().finite().min(0.1).max(MAX_DPI),
      mode: z.literal("dpi"),
    })
    .strict(),
  z
    .object({
      dpiHint: z.number().finite().min(0.1).max(MAX_DPI).optional(),
      mode: z.literal("width"),
      widthPx: z.number().int().positive().max(100_000),
    })
    .strict(),
  z
    .object({
      dpiHint: z.number().finite().min(0.1).max(MAX_DPI).optional(),
      heightPx: z.number().int().positive().max(100_000),
      mode: z.literal("height"),
    })
    .strict(),
  z
    .object({
      allowDistortion: z.boolean().default(false),
      dpiHint: z.number().finite().min(0.1).max(MAX_DPI).optional(),
      heightPx: z.number().int().positive().max(100_000),
      mode: z.literal("exact"),
      widthPx: z.number().int().positive().max(100_000),
    })
    .strict(),
]);
const pngBackgroundSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("document") }).strict(),
  z.object({ mode: z.literal("transparent") }).strict(),
  z
    .object({
      color: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
      mode: z.literal("solid"),
      opacity: z.number().finite().min(0).max(1),
    })
    .strict(),
]);
const textSchema = z.enum(["preserve", "paths"]);
const pngColorModeSchema = z.enum([
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
]);
const pngExportSchema = commonExportSchema
  .extend({
    antialias: z.number().int().min(0).max(3).optional(),
    area: pngAreaSchema,
    background: pngBackgroundSchema.default({ mode: "document" }),
    bitDepth: z.union([z.literal(8), z.literal(16)]).optional(),
    colorMode: pngColorModeSchema.optional(),
    compression: z.number().int().min(0).max(9).optional(),
    dithering: z.boolean().optional(),
    format: z.literal("png"),
    margin: edgeInsetsSchema.optional(),
    size: pngSizeSchema.optional(),
    snapAreaToPixels: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.bitDepth !== undefined &&
      value.colorMode !== undefined &&
      !value.colorMode.endsWith(`_${value.bitDepth}`)
    )
      context.addIssue({
        code: "custom",
        message: "PNG bitDepth must match colorMode",
        path: ["bitDepth"],
      });
  })
  .strict();
const pdfExportSchema = commonExportSchema
  .extend({
    area: vectorAreaSchema,
    filterRasterDpi: z.number().finite().min(0.1).max(MAX_DPI).optional(),
    filters: z.enum(["preserve", "ignore-with-warning"]),
    format: z.literal("pdf"),
    latex: z.boolean().optional(),
    margin: edgeInsetsSchema.optional(),
    text: textSchema,
    version: z.enum(["1.4", "1.5"]).optional(),
  })
  .strict();
const svgExportSchema = commonExportSchema
  .extend({
    area: vectorAreaSchema,
    format: z.enum(["svg", "plain-svg", "svgz"]),
    resourcePolicy: z.enum(["preserve-local", "embed", "reject-external"]),
    text: textSchema,
  })
  .strict();
const psExportSchema = commonExportSchema
  .extend({
    area: z.union([
      z.object({ kind: z.literal("drawing") }).strict(),
      selectionAreaSchema,
      z
        .object({
          kind: z.literal("pages"),
          pageIds: z.array(pageIdSchema).min(1).max(100),
        })
        .strict(),
    ]),
    filterRasterDpi: z.number().finite().min(0.1).max(MAX_DPI).optional(),
    format: z.literal("ps"),
    level: z.union([z.literal(2), z.literal(3)]),
    rasterizationPolicy: z
      .enum(["reject", "rasterize-with-warning"])
      .default("reject"),
    text: textSchema,
  })
  .strict();
const epsExportSchema = commonExportSchema
  .extend({
    area: z.union([
      z.object({ kind: z.literal("drawing") }).strict(),
      selectionAreaSchema,
    ]),
    filterRasterDpi: z.number().finite().min(0.1).max(MAX_DPI).optional(),
    format: z.literal("eps"),
    level: z.union([z.literal(2), z.literal(3)]),
    rasterizationPolicy: z
      .enum(["reject", "rasterize-with-warning"])
      .default("reject"),
    text: textSchema,
  })
  .strict();
const metafileExportSchema = commonExportSchema
  .extend({
    area: z.union([
      z.object({ kind: z.literal("drawing") }).strict(),
      selectionAreaSchema,
    ]),
    format: z.enum(["emf", "wmf", "xaml"]),
    flattenPolicy: z.enum(["reject", "flatten-with-warning"]).default("reject"),
  })
  .strict();

export const exportSpecSchema = z
  .discriminatedUnion("format", [
    pngExportSchema,
    pdfExportSchema,
    svgExportSchema,
    psExportSchema,
    epsExportSchema,
    metafileExportSchema,
  ])
  .superRefine((value, context) => {
    const selection = value.area.kind === "selection" ? value.area : undefined;
    const pages =
      value.format === "png" && value.area.kind === "page"
        ? value.area.pageIds
        : undefined;
    const needsMultiOutput =
      selection?.output === "each" || (pages !== undefined && pages.length > 1);
    if (needsMultiOutput && value.target.kind !== "directory")
      context.addIssue({
        code: "custom",
        message: "Multiple export variants require a directory output target",
        path: ["target"],
      });
    if (!needsMultiOutput && value.target.kind !== "file")
      context.addIssue({
        code: "custom",
        message: "A single export result requires a file output target",
        path: ["target"],
      });
  });

export type ExportSpec = z.output<typeof exportSpecSchema>;
export type ExportInput = z.input<typeof exportSpecSchema>;
export type ExportPreset = z.output<typeof exportPresetSchema>;
export type OutputTarget = z.output<typeof outputTargetSchema>;
export type MultiOutputTarget = z.output<typeof multiOutputTargetSchema>;
export type ExportArea = ExportSpec["area"];

export function parseExportSpec(input: unknown): ExportSpec {
  return exportSpecSchema.parse(input);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}
