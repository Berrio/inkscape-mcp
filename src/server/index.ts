import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import packageMetadata from "../../package.json" with { type: "json" };
import { type ServerConfig } from "../config/index.js";
import { runDoctor } from "../doctor/index.js";

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

  return server;
}
