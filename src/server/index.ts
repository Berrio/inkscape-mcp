import { McpServer } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { assertDocumentWorkspace, type ServerConfig } from "../config/index.js";
import {
  createSvgDocument,
  inspectSvgSettings,
  parseViewportLength,
  resizePageOnlySvg,
} from "../documents/index.js";
import { runDoctor } from "../doctor/index.js";
import { locateInkscape, probeInkscapeCandidate } from "../discovery/index.js";
import { verifyPdf, verifyPng } from "../export/index.js";
import { ProcessRunner } from "../runner/index.js";
import { AtomicFileStore, ScratchManager } from "../storage/index.js";
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
        "Creates a new SVG document within an authorized workspace. Existing outputs are never overwritten.",
      inputSchema: z.object({
        height: z.number().finite().positive(),
        outputPath: z.string().min(1).max(1024),
        unit: z.enum(["mm", "cm", "in", "pt", "pc", "q", "px"]),
        width: z.number().finite().positive(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        documentPath: z.string(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      annotations: { destructiveHint: false },
    },
    async ({ height, outputPath, unit, width, workspaceId }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const target = await workspace.resolveNewOutput(workspaceId, outputPath);
      if (!/\.svg$/iu.test(target.relativePath))
        throw new Error("document_create requires a .svg output path");
      const svg = createSvgDocument({
        page: {
          width: { unit, value: width },
          height: { unit, value: height },
        },
      });
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
    "document_resize",
    {
      description:
        "Changes the SVG page size with page_only semantics while preserving element geometry. Requires the current document revision.",
      inputSchema: z.object({
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        height: z.number().finite().positive(),
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
    async ({ expectedRevision, height, path, unit, width, workspaceId }) => {
      assertDocumentWorkspace(config);
      const workspace = await workspaces();
      const document = await workspace.resolveExisting(workspaceId, path);
      const source = await readFile(document.absolutePath, "utf8");
      const settings = inspectSvgSettings(source);
      const currentPage = {
        width: parseViewportLength(settings.width),
        height: parseViewportLength(settings.height),
      };
      const resized = resizePageOnlySvg(source, currentPage, {
        width: { unit, value: width },
        height: { unit, value: height },
      });
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
    "export_png",
    {
      description:
        "Exports an SVG document to PNG through Inkscape using only bounded, allowlisted options.",
      inputSchema: z.object({
        expectedOutputRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
        height: z.number().int().positive().max(100_000).optional(),
        outputPath: z.string().min(1).max(1024),
        path: z.string().min(1).max(1024),
        width: z.number().int().positive().max(100_000).optional(),
        workspaceId: z.string().regex(/^ws_[a-f0-9]{16}$/u),
      }),
      outputSchema: z.object({
        height: z.number().int().positive(),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        width: z.number().int().positive(),
      }),
      annotations: { destructiveHint: false },
    },
    async ({
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
        throw new Error("export_png requires a .png output path");
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
        const temporaryOutput = join(directory, "export.png");
        const result = await runner.run(candidate.executablePath, {
          args: [
            input.absolutePath,
            "--export-type=png",
            `--export-filename=${temporaryOutput}`,
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
      const result = { ...png.metadata, revision: committed.revision };
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
        const temporaryOutput = join(directory, "export.pdf");
        const result = await runner.run(candidate.executablePath, {
          args: [
            input.absolutePath,
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
        revision: committed.revision,
        version: pdf.metadata.version,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}
