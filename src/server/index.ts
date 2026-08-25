import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { assertDocumentWorkspace, type ServerConfig } from "../config/index.js";
import { createSvgDocument } from "../documents/index.js";
import { runDoctor } from "../doctor/index.js";
import { AtomicFileStore } from "../storage/index.js";
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

  return server;
}
