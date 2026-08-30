import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f03-css-resize-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const client = new Client(
  { name: "inkscape-mcp-f03-css-resize", version: packageMetadata.version },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport(server);

try {
  await client.connect(transport);
  const listed = await client.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = listed.structuredContent?.workspaces?.[0];
  if (listed.isError || typeof workspace?.id !== "string")
    throw new Error("workspace_list did not return an authorized workspace");

  const supportedPath = "f03-css-supported.svg";
  await copyFile(
    join(process.cwd(), "tests", "fixtures", "f03-css-resize-supported.svg"),
    join(workspaceRoot, supportedPath),
  );
  const supportedRevision = revision(
    await readFile(join(workspaceRoot, supportedPath)),
  );
  const supported = await client.callTool({
    arguments: {
      dryRun: true,
      expectedRevision: supportedRevision,
      height: 600,
      mode: "scale_content_contain",
      path: supportedPath,
      unit: "px",
      width: 600,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    supported.isError ||
    supported.structuredContent?.contentFidelity !== "exact" ||
    supported.structuredContent?.contentLimitations?.length !== 0 ||
    supported.structuredContent?.dryRun !== true ||
    revision(await readFile(join(workspaceRoot, supportedPath))) !==
      supportedRevision
  )
    throw new Error(
      "supported CSS content resize did not report exact dry-run fidelity",
    );

  const rejectedPath = "f03-css-rejected.svg";
  await copyFile(
    join(process.cwd(), "tests", "fixtures", "f03-css-resize-rejected.svg"),
    join(workspaceRoot, rejectedPath),
  );
  const rejectedRevision = revision(
    await readFile(join(workspaceRoot, rejectedPath)),
  );
  const rejected = await client.callTool({
    arguments: {
      expectedRevision: rejectedRevision,
      height: 600,
      mode: "scale_content_contain",
      path: rejectedPath,
      unit: "px",
      width: 600,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    !rejected.isError ||
    revision(await readFile(join(workspaceRoot, rejectedPath))) !==
      rejectedRevision
  )
    throw new Error(
      "unsupported CSS content resize was not rejected atomically",
    );
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F03 CSS resize MCP checks passed.\n");
