import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f08-fingerprint-"),
);
const profileRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-f08-profile-"));
await mkdir(join(profileRoot, "extensions"));

const client = new Client(
  {
    name: "inkscape-mcp-f08-plan-capability-fingerprint",
    version: packageMetadata.version,
  },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport({
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  env: { INKSCAPE_PROFILE_DIR: profileRoot },
  stderr: "pipe",
});

function requireSuccess(result, label) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${label} returned an MCP error`);
  return result.structuredContent;
}

try {
  const sourceBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect width="40" height="20" fill="#336699"/></svg>',
    "utf8",
  );
  await writeFile(join(workspaceRoot, "source.svg"), sourceBytes);
  const sourceRevision = createHash("sha256").update(sourceBytes).digest("hex");

  await client.connect(transport);
  const workspaces = requireSuccess(
    await client.callTool({ arguments: {}, name: "workspace_list" }),
    "workspace_list",
  );
  const workspaceId = workspaces.workspaces?.[0]?.id;
  if (typeof workspaceId !== "string")
    throw new Error("workspace_list did not return an opaque workspace ID");
  const outputPath = "capability-drift/plain.svg";
  const plan = requireSuccess(
    await client.callTool({
      arguments: {
        preset: {
          name: "plain-svg",
          outputDirectory: "capability-drift",
          source: { expectedRevision: sourceRevision, path: "source.svg" },
        },
        workspaceId,
      },
      name: "document_export_preset_plan",
    }),
    "document_export_preset_plan",
  );
  if (typeof plan.planToken !== "string")
    throw new Error("preset plan did not return an owner-bound token");

  const profileState = join(profileRoot, "capability-fingerprint-state");
  await writeFile(profileState, "changed after plan", "utf8");
  const changedAt = new Date(Date.now() + 2_000);
  await utimes(profileRoot, changedAt, changedAt);

  const drifted = await client.callTool({
    arguments: {
      mode: "all_or_nothing",
      planToken: plan.planToken,
      workspaceId,
    },
    name: "document_export_batch",
  });
  if (
    !drifted.isError ||
    !drifted.content.some(
      (item) =>
        item.type === "text" &&
        item.text.includes("Preset plan capabilities no longer match"),
    ) ||
    existsSync(join(workspaceRoot, outputPath))
  )
    throw new Error(
      "capability fingerprint drift did not reject the token before publication",
    );

  const consumed = await client.callTool({
    arguments: {
      mode: "all_or_nothing",
      planToken: plan.planToken,
      workspaceId,
    },
    name: "document_export_batch",
  });
  if (!consumed.isError)
    throw new Error("a capability-invalidated plan token was reusable");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
  await rm(profileRoot, { force: true, recursive: true });
}

process.stderr.write("F08 plan capability fingerprint MCP checks passed.\n");
