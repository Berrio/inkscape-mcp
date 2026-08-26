import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { assertDocumentWorkspace, type ServerConfig } from "../config/index.js";
import {
  addSvgPage,
  adjustPageMarginsSvg,
  changePageOrientationSvg,
  createSvgDocument,
  createSvgShapes,
  arrangeSvgShapes,
  groupSvgShapes,
  deleteSvgShapes,
  transformSvgShapes,
  updateSvgShapes,
  deleteSvgPage,
  fitPageToBoundsSvg,
  inspectDocumentDisplaySettings,
  inspectSvgInventory,
  inspectSvgSettings,
  listSvgPages,
  pageSizeFromPreset,
  parseViewportLength,
  preflightSvg,
  querySvgElementTargets,
  reorderSvgPages,
  resizeContentSvg,
  resizePageOnlySvg,
  updateSvgPage,
  updateDocumentDisplaySettings,
  validateSvgPageLayout,
} from "../documents/index.js";
import { nativeVisualBoundsDescriptor } from "../geometry/index.js";
import { summarizeSvgDiff } from "../svg/index.js";
import { runDoctor } from "../doctor/index.js";
import { locateInkscape, probeInkscapeCandidate } from "../discovery/index.js";
import { verifyPdf, verifyPng, verifySvg } from "../export/index.js";
import {
  parseInkscapeQueryAll,
  type InkscapeBounds,
} from "../inkscape/index.js";
import { ProcessRunner } from "../runner/index.js";
import {
  AtomicFileStore,
  ArtifactStore,
  createNativeInputBundle,
  ScratchManager,
  sha256File,
  SnapshotStore,
} from "../storage/index.js";
import { WorkspaceService } from "../workspace/index.js";

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
  duplicateIds: z.array(z.string()),
  elementCount: z.number().int().nonnegative(),
  externalResourceCount: z.number().int().nonnegative(),
  fontFamilies: z.array(z.string()),
  fontResolution: z.literal("unavailable"),
  images: z.array(
    z.object({ kind: z.enum(["embedded", "external", "linked"]) }),
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
  paintUsage: z.object({
    fills: z.number().int().nonnegative(),
    filters: z.number().int().nonnegative(),
    gradients: z.number().int().nonnegative(),
    opacities: z.number().int().nonnegative(),
    patterns: z.number().int().nonnegative(),
    strokes: z.number().int().nonnegative(),
  }),
  typeCounts: z.record(z.string(), z.number().int().nonnegative()),
  truncated: z.boolean(),
  unknownNamespaces: z.array(z.string()),
  unresolvedReferences: z.array(z.string()),
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
  fill: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .optional(),
  fontFamily: z.string().min(1).max(256).optional(),
  fontSize: z.number().finite().positive().max(10_000).optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  stroke: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .optional(),
  strokeWidth: z.number().finite().nonnegative().optional(),
  textAnchor: z.enum(["start", "middle", "end"]).optional(),
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
  id: shapeIdSchema.optional(),
  kind: z.string(),
  layerId: shapeIdSchema.optional(),
  parentId: shapeIdSchema.optional(),
});
const nativeVisualBounds = nativeVisualBoundsDescriptor();

export function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "inkscape-mcp",
    version: packageMetadata.version,
  });
  const fileStore = new AtomicFileStore();
  const runner = new ProcessRunner(config.maxConcurrency);
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
  const workspaces = () => WorkspaceService.create(config.workspaceRoots);

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
        "Moves same-parent SVG elements to front, back, one step up, or one step down without accepting arbitrary order indexes.",
      inputSchema: z.object({
        action: z.enum(["back", "front", "lower", "raise"]),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        ids: z.array(shapeIdSchema).min(1).max(100),
        path: z.string().min(1).max(1024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        action: z.enum(["back", "front", "lower", "raise"]),
        backupCreated: z.boolean(),
        ids: z.array(shapeIdSchema),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ action, expectedRevision, ids, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const arranged = arrangeSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        ids,
        action,
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
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const created = createSvgShapes(
        await readFile(document.absolutePath, "utf8"),
        elements,
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
    "document_inspect",
    {
      description:
        "Reads SVG viewport dimensions, viewBox and revision from an authorized document without mutating it.",
      inputSchema: z.object({
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
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
    async ({ expectedRevision, level, path, workspaceId }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const revision = await sha256File(document.absolutePath);
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw new Error("Document revision no longer matches");
      const source = await readFile(document.absolutePath, "utf8");
      const settings = inspectSvgSettings(source);
      const output = {
        ...settings,
        heightUnit: parseViewportLength(settings.height).unit,
        inspectionLevel: level,
        ...(level === "summary"
          ? {}
          : {
              inventory: inspectSvgInventory(
                source,
                level === "deep" ? 1_000 : 100,
              ),
            }),
        pages: listSvgPages(source),
        revision,
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
        "Checks an SVG for active content, external references and invalid document settings without modifying it.",
      inputSchema: z.object({
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
        profile: z.enum(["basic", "web", "print", "interchange"]),
        valid: z.boolean(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ path, profile, workspaceId }) => {
      assertDocumentWorkspace(config);
      const document = await (
        await workspaces()
      ).resolveExisting(workspaceId, path);
      const preflight = preflightSvg(
        await readFile(document.absolutePath, "utf8"),
        profile,
      );
      const output = {
        issues: preflight.issues,
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
      inputSchema: z.object({
        area: z.enum(["drawing", "page"]).default("page"),
        expectedOutputRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        height: z.number().int().positive().max(2_048).optional(),
        outputPath: z.string().min(1).max(1024),
        path: z.string().min(1).max(1024),
        width: z.number().int().positive().max(2_048).default(1_024),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        area: z.enum(["drawing", "page"]),
        artifact: artifactSchema,
        documentPath: z.string(),
        height: z.number().int().positive(),
        inline: z.boolean(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
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
      path,
      width,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.png$/iu.test(output.relativePath))
        throw new Error("document_render_preview requires a .png output path");
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
      const preview = await scratch.withDirectory(
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
          const temporaryOutput = join(directory, "preview.png");
          const result = await runner.run(candidate.executablePath, {
            args: [
              nativeInput.path,
              "--export-type=png",
              `--export-filename=${temporaryOutput}`,
              area === "drawing"
                ? "--export-area-drawing"
                : "--export-area-page",
              "--export-background-opacity=0",
              `--export-width=${width}`,
              ...(height === undefined ? [] : [`--export-height=${height}`]),
            ],
            cwd: directory,
            maxStderrBytes: config.maxStderrBytes,
            maxStdoutBytes: config.maxStdoutBytes,
            timeoutMs: config.processTimeoutMs,
          });
          if (result.exitCode !== 0 || result.terminationReason !== "completed")
            throw new Error("Inkscape preview render failed");
          const bytes = await readFile(temporaryOutput);
          if (bytes.byteLength > config.maxArtifactBytes)
            throw new Error("Preview exceeds configured artifact size limit");
          await nativeInput.assertCurrent();
          return { bytes, metadata: await verifyPng(temporaryOutput) };
        },
      );
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
        area,
        artifact,
        documentPath: output.relativePath,
        height: preview.metadata.height,
        inline: preview.bytes.byteLength <= config.maxInlineBytes,
        revision: committed.revision,
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
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "export_png",
    {
      description:
        "Exports an SVG document to PNG through Inkscape using only bounded, allowlisted options.",
      inputSchema: z.object({
        area: z.enum(["drawing", "page"]).default("page"),
        background: z
          .enum(["document", "solid", "transparent"])
          .default("document"),
        backgroundColor: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/u)
          .optional(),
        backgroundOpacity: z.number().finite().min(0).max(1).optional(),
        expectedOutputRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        dpi: z.number().finite().positive().max(9_600).optional(),
        height: z.number().int().positive().max(100_000).optional(),
        outputPath: z.string().min(1).max(1024),
        path: z.string().min(1).max(1024),
        width: z.number().int().positive().max(100_000).optional(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        area: z.enum(["drawing", "page"]),
        background: z.enum(["document", "solid", "transparent"]),
        dpiX: z.number().positive().optional(),
        dpiY: z.number().positive().optional(),
        height: z.number().int().positive(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        width: z.number().int().positive(),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      area,
      background,
      backgroundColor,
      backgroundOpacity,
      expectedOutputRevision,
      expectedRevision,
      dpi,
      height,
      outputPath,
      path,
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
          background === "transparent"
            ? ["--export-background-opacity=0"]
            : background === "solid"
              ? [
                  `--export-background=${backgroundColor!}`,
                  `--export-background-opacity=${backgroundOpacity ?? 1}`,
                ]
              : [
                  `--export-background=${displaySettings.pageColor}`,
                  `--export-background-opacity=${displaySettings.pageOpacity}`,
                ];
        const temporaryOutput = join(directory, "export.png");
        const result = await runner.run(candidate.executablePath, {
          args: [
            nativeInput.path,
            "--export-type=png",
            `--export-filename=${temporaryOutput}`,
            area === "drawing" ? "--export-area-drawing" : "--export-area-page",
            ...backgroundArguments,
            ...(dpi === undefined ? [] : [`--export-dpi=${dpi}`]),
            ...(width === undefined ? [] : [`--export-width=${width}`]),
            ...(height === undefined ? [] : [`--export-height=${height}`]),
          ],
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
        area,
        background,
        revision: committed.revision,
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
      inputSchema: z.object({
        expectedOutputRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        outputPath: z.string().min(1).max(1024),
        path: z.string().min(1).max(1024),
        pdfVersion: z.enum(["1.4", "1.5"]).optional(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        mediaBoxes: z.array(
          z.object({
            height: z.number().positive(),
            width: z.number().positive(),
          }),
        ),
        pageCount: z.number().int().positive(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        version: z.string().regex(/^1\.[0-9]$/u),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
      expectedOutputRevision,
      expectedRevision,
      outputPath,
      path,
      pdfVersion,
      workspaceId,
    }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const input = await workspace.resolveExisting(workspaceId, path);
      const output = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.pdf$/iu.test(output.relativePath))
        throw new Error("export_pdf requires a .pdf output path");
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
        const temporaryOutput = join(directory, "export.pdf");
        const result = await runner.run(candidate.executablePath, {
          args: [
            nativeInput.path,
            "--export-type=pdf",
            `--export-filename=${temporaryOutput}`,
            ...(pdfVersion === undefined
              ? []
              : [`--export-pdf-version=${pdfVersion}`]),
          ],
          cwd: directory,
          maxStderrBytes: config.maxStderrBytes,
          maxStdoutBytes: config.maxStdoutBytes,
          timeoutMs: config.processTimeoutMs,
        });
        if (result.exitCode !== 0 || result.terminationReason !== "completed")
          throw new Error("Inkscape PDF export failed");
        await nativeInput.assertCurrent();
        return {
          bytes: await readFile(temporaryOutput),
          metadata: await verifyPdf(temporaryOutput),
        };
      });
      const committed = await fileStore.commit({
        contents: pdf.bytes,
        ...(expectedOutputRevision === undefined
          ? {}
          : { expectedOutputRevision }),
        expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      const result = {
        mediaBoxes: pdf.metadata.mediaBoxes,
        pageCount: pdf.metadata.pageCount,
        revision: committed.revision,
        version: pdf.metadata.version,
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
        textToPath: z.boolean().default(false),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        flavor: z.enum(["inkscape", "plain"]),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
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
        const temporaryOutput = join(directory, "export.svg");
        const run = await runner.run(candidate.executablePath, {
          args: [
            nativeInput.path,
            "--export-type=svg",
            `--export-filename=${temporaryOutput}`,
            ...(flavor === "plain" ? ["--export-plain-svg"] : []),
            ...(textToPath ? ["--export-text-to-path"] : []),
          ],
          cwd: directory,
          maxStderrBytes: config.maxStderrBytes,
          maxStdoutBytes: config.maxStdoutBytes,
          timeoutMs: config.processTimeoutMs,
        });
        if (run.exitCode !== 0 || run.terminationReason !== "completed")
          throw new Error("Inkscape SVG export failed");
        await verifySvg(temporaryOutput);
        await nativeInput.assertCurrent();
        return readFile(temporaryOutput);
      });
      const committed = await fileStore.commit({
        contents: svg,
        ...(expectedOutputRevision === undefined
          ? {}
          : { expectedOutputRevision }),
        expectedRevision,
        sourcePath: input.absolutePath,
        targetPath: output.absolutePath,
      });
      const result = {
        flavor,
        revision: committed.revision,
        warnings: textToPath ? ["TEXT_CONVERTED_TO_PATHS"] : [],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
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
    const result = await request.runner.run(candidate.executablePath, {
      args: [nativeInput.path, "--query-all"],
      cwd: directory,
      maxStderrBytes: request.config.maxStderrBytes,
      maxStdoutBytes: request.config.maxStdoutBytes,
      timeoutMs: request.config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed")
      throw new Error("Inkscape bounds query failed");
    await nativeInput.assertCurrent();
    return parseInkscapeQueryAll(result.stdout.toString("utf8"));
  });
}
