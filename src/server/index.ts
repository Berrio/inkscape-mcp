import { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { assertDocumentWorkspace, type ServerConfig } from "../config/index.js";
import {
  addSvgPage,
  createSvgDocument,
  deleteSvgPage,
  inspectDocumentDisplaySettings,
  inspectSvgInventory,
  inspectSvgSettings,
  listSvgPages,
  pageSizeFromPreset,
  parseViewportLength,
  preflightSvg,
  reorderSvgPages,
  resizeContentSvg,
  resizePageOnlySvg,
  updateSvgPage,
  updateDocumentDisplaySettings,
} from "../documents/index.js";
import { runDoctor } from "../doctor/index.js";
import { locateInkscape, probeInkscapeCandidate } from "../discovery/index.js";
import { verifyPdf, verifyPng, verifySvg } from "../export/index.js";
import { ProcessRunner } from "../runner/index.js";
import {
  AtomicFileStore,
  createNativeInputBundle,
  ScratchManager,
  sha256File,
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
const pageSchema = z.object({
  height: z.number().finite().positive(),
  id: z.string().regex(/^page_[A-Za-z0-9_-]{1,120}$/u),
  label: z.string().min(1).max(256).optional(),
  width: z.number().finite().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
});
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
  const workspaces = () => WorkspaceService.create(config.workspaceRoots);

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
        height: z.string(),
        heightUnit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
        inspectionLevel: z.enum(["summary", "standard", "deep"]),
        inventory: inventorySchema.optional(),
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
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        warnings: z.array(z.string()),
      }),
      annotations: { destructiveHint: true },
    },
    async ({
      anchor,
      expectedRevision,
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
      const result = await fileStore.commit({
        contents: Buffer.from(resized.svg),
        expectedOutputRevision: expectedRevision,
        expectedRevision,
        sourcePath: document.absolutePath,
        targetPath: document.absolutePath,
      });
      const output = {
        backupCreated: result.backupPath !== undefined,
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
        );
        const displaySettings = inspectDocumentDisplaySettings(
          await readFile(input.absolutePath, "utf8"),
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
