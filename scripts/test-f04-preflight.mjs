import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f04-preflight-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const fixtures = {
  "interchange-negative.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10mm" height="10mm" viewBox="0 0 10 10"><flowRoot/><path inkscape:path-effect="#effect"/><inkscape:path-effect id="effect"/><image href="https://example.test/private.png"/><meshgradient/></svg>',
  "invalid-negative.svg": '<svg xmlns="http://www.w3.org/2000/svg"><g>',
  "print-negative.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur/></filter></defs><text style="font-family: Forte">SENSITIVE PREFLIGHT CONTENT</text><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" width="100" height="100" filter="url(#blur)"/></svg>',
  "web-negative.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="1px" height="1px"><script>secret()</script><foreignObject/><rect id="duplicate"/><circle id="duplicate"/><use href="#missing"/><image href="https://example.test/private.png"/><text style="font-family: Forte">SENSITIVE PREFLIGHT CONTENT</text></svg>',
};

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requirePreflight(result, label) {
  if (result.isError || result.structuredContent?.issues === undefined)
    throw new Error(`${label} did not return a preflight result`);
  return result.structuredContent;
}

function requireIssues(result, expected, label) {
  const byCode = new Map(result.issues.map((issue) => [issue.code, issue]));
  for (const [code, severity] of expected)
    if (byCode.get(code)?.severity !== severity)
      throw new Error(`${label} missed ${code} with severity ${severity}`);
}

const client = new Client(
  { name: "inkscape-mcp-f04-preflight", version: packageMetadata.version },
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

  await Promise.all(
    Object.entries(fixtures).map(([path, source]) =>
      writeFile(join(workspaceRoot, path), source, "utf8"),
    ),
  );
  const before = new Map(
    await Promise.all(
      Object.keys(fixtures).map(async (path) => [
        path,
        revision(await readFile(join(workspaceRoot, path))),
      ]),
    ),
  );

  const web = requirePreflight(
    await client.callTool({
      arguments: {
        path: "web-negative.svg",
        profile: "web",
        workspaceId: workspace.id,
      },
      name: "document_preflight",
    }),
    "web preflight",
  );
  if (web.valid !== false || web.profile !== "web")
    throw new Error("web preflight treated critical defects as valid");
  requireIssues(
    web,
    [
      ["SVG_ACTIVE_CONTENT", "error"],
      ["SVG_DUPLICATE_ID", "error"],
      ["SVG_EXTERNAL_RESOURCE", "warning"],
      ["SVG_UNRESOLVED_REFERENCE", "warning"],
      ["WEB_MISSING_VIEWBOX", "warning"],
      ["SVG_MISSING_TITLE", "warning"],
      ["SVG_MISSING_DESCRIPTION", "warning"],
      ["WEB_IMAGE_ACCESSIBLE_NAME_MISSING", "warning"],
      ["WEB_FONT_RESOLUTION_UNAVAILABLE", "warning"],
      ["WEB_EXTERNAL_REFERENCE", "warning"],
    ],
    "web preflight",
  );

  const print = requirePreflight(
    await client.callTool({
      arguments: {
        bleed: {
          behavior: "expand-temporary-page",
          bottom: { unit: "mm", value: 2 },
          left: { unit: "mm", value: 4 },
          right: { unit: "mm", value: 3 },
          top: { unit: "mm", value: 1 },
        },
        path: "print-negative.svg",
        profile: "print",
        workspaceId: workspace.id,
      },
      name: "document_preflight",
    }),
    "print preflight",
  );
  if (
    print.profile !== "print" ||
    print.print?.images?.lowDpiCount !== 1 ||
    print.print?.images?.measuredCount !== 1 ||
    print.print?.bleed?.missingMm?.left !== 4 ||
    print.print?.bleed?.missingMm?.top !== 1
  )
    throw new Error(
      "print preflight did not report typed DPI and bleed details",
    );
  requireIssues(
    print,
    [
      ["PRINT_FONT_RESOLUTION_UNAVAILABLE", "warning"],
      ["PRINT_FILTER_RASTERIZATION_RISK", "warning"],
      ["PRINT_IMAGE_LOW_EFFECTIVE_DPI", "warning"],
      ["PRINT_COLOR_MANAGEMENT_UNVERIFIED", "warning"],
    ],
    "print preflight",
  );

  const interchange = requirePreflight(
    await client.callTool({
      arguments: {
        path: "interchange-negative.svg",
        profile: "interchange",
        workspaceId: workspace.id,
      },
      name: "document_preflight",
    }),
    "interchange preflight",
  );
  requireIssues(
    interchange,
    [
      ["SVG_EXTERNAL_RESOURCE", "warning"],
      ["SVG_INKSCAPE_FEATURES", "warning"],
      ["INTERCHANGE_FLOW_TEXT", "warning"],
      ["INTERCHANGE_LIVE_PATH_EFFECT", "warning"],
      ["INTERCHANGE_EXTERNAL_REFERENCE", "warning"],
      ["INTERCHANGE_ADVANCED_SVG_FEATURE", "warning"],
    ],
    "interchange preflight",
  );

  const invalid = requirePreflight(
    await client.callTool({
      arguments: {
        path: "invalid-negative.svg",
        profile: "basic",
        workspaceId: workspace.id,
      },
      name: "document_preflight",
    }),
    "invalid preflight",
  );
  if (invalid.valid !== false)
    throw new Error("invalid SVG preflight reported a false success");
  requireIssues(
    invalid,
    [["SVG_INVALID_DOCUMENT", "error"]],
    "invalid preflight",
  );

  const serialized = JSON.stringify({ interchange, print, web });
  if (
    serialized.includes("SENSITIVE PREFLIGHT CONTENT") ||
    serialized.includes("example.test/private.png")
  )
    throw new Error("document_preflight leaked document content or URLs");
  for (const [path, expected] of before)
    if (revision(await readFile(join(workspaceRoot, path))) !== expected)
      throw new Error("document_preflight modified a negative fixture");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F04 preflight MCP checks passed.\n");
