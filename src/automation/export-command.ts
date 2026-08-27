import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";

import { assertSafeRelativePath } from "../workspace/index.js";

const presetNameSchema = z.enum([
  "print-a4-pdf",
  "print-pdf-300dpi",
  "web-png",
  "web-asset-pack",
  "plain-svg",
  "icon-pack",
]);
const relativePathSchema = z.string().min(1).max(1_024);

const workspaceListSchema = z.object({
  workspaces: z
    .array(z.object({ id: z.string() }))
    .min(1)
    .max(32),
});
const documentInspectionSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
});
const presetPlanSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.number().int().positive(),
  outputDirectory: relativePathSchema,
  outputPaths: z.array(relativePathSchema).min(1).max(50),
  planToken: z.string().regex(/^plan_[a-f0-9]{32}$/u),
  variantCount: z.number().int().positive().max(50),
});

export type AutonomousExportRequest = {
  configArguments: readonly string[];
  dryRun: boolean;
  outputDirectory: string;
  preset: z.output<typeof presetNameSchema>;
  source: string;
  workspaceIndex: number;
};

export type AutonomousExportResult =
  | {
      digest: string;
      expiresAt: number;
      outputDirectory: string;
      outputPaths: readonly string[];
      preset: string;
      revision: string;
      source: string;
      status: "planned";
      variantCount: number;
    }
  | {
      manifest: unknown;
      outputDirectory: string;
      preset: string;
      revision: string;
      source: string;
      status: "completed";
      successes: readonly unknown[];
    };

export type AutonomousMcpSession = {
  client: Client;
  workspaceId: string;
};
export type AutonomousPresetPlan = z.output<typeof presetPlanSchema>;

/** Parses only the autonomous-export flags, preserving normal server config flags. */
export function parseAutonomousExportArguments(
  argumentsList: readonly string[],
): AutonomousExportRequest {
  let source: string | undefined;
  let preset: string | undefined;
  let outputDirectory: string | undefined;
  let workspaceIndex = 0;
  let dryRun = false;
  const configArguments: string[] = [];

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    switch (argument) {
      case "--dry-run":
        if (dryRun) throw new Error("--dry-run may only be supplied once");
        dryRun = true;
        break;
      case "--source":
      case "--preset":
      case "--output-directory":
      case "--workspace-index": {
        const value = argumentsList[index + 1];
        if (value === undefined)
          throw new Error(`Missing value for ${argument}`);
        index += 1;
        if (argument === "--source") {
          if (source !== undefined)
            throw new Error("--source may only be supplied once");
          source = value;
        } else if (argument === "--preset") {
          if (preset !== undefined)
            throw new Error("--preset may only be supplied once");
          preset = value;
        } else if (argument === "--output-directory") {
          if (outputDirectory !== undefined)
            throw new Error("--output-directory may only be supplied once");
          outputDirectory = value;
        } else {
          if (!/^(?:[0-9]|[12][0-9]|3[01])$/u.test(value))
            throw new Error(
              "--workspace-index must be an integer from 0 to 31",
            );
          workspaceIndex = Number(value);
        }
        break;
      }
      default:
        configArguments.push(argument);
    }
  }

  if (source === undefined) throw new Error("--source is required");
  if (preset === undefined) throw new Error("--preset is required");
  if (outputDirectory === undefined)
    throw new Error("--output-directory is required");

  return {
    configArguments,
    dryRun,
    outputDirectory: parseSafeRelativePath(outputDirectory),
    preset: presetNameSchema.parse(preset),
    source: parseSafeRelativePath(source),
    workspaceIndex,
  };
}

function parseSafeRelativePath(value: string): string {
  relativePathSchema.parse(value);
  assertSafeRelativePath(value);
  return value;
}

/** Opens one private stdio MCP session without bypassing its public contracts. */
export async function withAutonomousMcp<T>(
  request: Pick<AutonomousExportRequest, "configArguments" | "workspaceIndex">,
  serverEntry: string,
  operation: (session: AutonomousMcpSession) => Promise<T>,
): Promise<T> {
  const client = new Client(
    { name: "inkscape-mcp-autonomous-cli", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StdioClientTransport({
    args: [serverEntry, ...request.configArguments],
    command: process.execPath,
    cwd: process.cwd(),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const workspaceResult = await client.callTool({
      arguments: {},
      name: "workspace_list",
    });
    if (workspaceResult.isError)
      throw new Error("Unable to list configured workspaces");
    const workspaces = workspaceListSchema.parse(
      workspaceResult.structuredContent,
    ).workspaces;
    const workspace = workspaces[request.workspaceIndex];
    if (workspace === undefined)
      throw new Error(
        `--workspace-index ${request.workspaceIndex} is not configured`,
      );
    return await operation({ client, workspaceId: workspace.id });
  } finally {
    await client.close();
  }
}

export async function inspectAutonomousSource(
  session: AutonomousMcpSession,
  source: string,
): Promise<string> {
  const inspection = await session.client.callTool({
    arguments: {
      level: "summary",
      path: source,
      workspaceId: session.workspaceId,
    },
    name: "document_inspect",
  });
  if (inspection.isError) throw new Error("Unable to inspect the source SVG");
  return documentInspectionSchema.parse(inspection.structuredContent).revision;
}

export async function createAutonomousPresetPlan(
  session: AutonomousMcpSession,
  request: Pick<
    AutonomousExportRequest,
    "outputDirectory" | "preset" | "source"
  > & { revision: string; ttlMs?: number },
): Promise<AutonomousPresetPlan> {
  const planResponse = await session.client.callTool({
    arguments: {
      preset: {
        name: request.preset,
        outputDirectory: request.outputDirectory,
        source: { expectedRevision: request.revision, path: request.source },
      },
      ...(request.ttlMs === undefined ? {} : { ttlMs: request.ttlMs }),
      workspaceId: session.workspaceId,
    },
    name: "document_export_preset_plan",
  });
  if (planResponse.isError)
    throw new Error("Unable to preflight the export preset");
  return presetPlanSchema.parse(planResponse.structuredContent);
}

export async function executeAutonomousPresetPlan(
  session: AutonomousMcpSession,
  planToken: string,
): Promise<{ manifest: unknown; successes: readonly unknown[] }> {
  const execution = await session.client.callTool({
    arguments: {
      mode: "all_or_nothing",
      planToken,
      workspaceId: session.workspaceId,
    },
    name: "document_export_batch",
  });
  if (execution.isError) throw new Error("Export preset failed");
  return z
    .object({ manifest: z.unknown(), successes: z.array(z.unknown()) })
    .parse(execution.structuredContent);
}

/**
 * Runs one named export through a private stdio MCP child.  It intentionally
 * uses the public MCP tools, so the human CLI cannot bypass workspace,
 * revision, capability, staging, or output-publication policies.
 */
export async function runAutonomousExport(
  request: AutonomousExportRequest,
  serverEntry: string,
): Promise<AutonomousExportResult> {
  return await withAutonomousMcp(request, serverEntry, async (session) => {
    const revision = await inspectAutonomousSource(session, request.source);
    const plan = await createAutonomousPresetPlan(session, {
      ...request,
      revision,
    });
    const common = {
      outputDirectory: plan.outputDirectory,
      preset: request.preset,
      revision,
      source: request.source,
    };
    if (request.dryRun)
      return {
        ...common,
        digest: plan.digest,
        expiresAt: plan.expiresAt,
        outputPaths: plan.outputPaths,
        status: "planned",
        variantCount: plan.variantCount,
      };

    const result = await executeAutonomousPresetPlan(session, plan.planToken);
    return { ...common, ...result, status: "completed" };
  });
}
