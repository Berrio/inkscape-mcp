import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f04-inventory-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:private="urn:private"><style>.label { font-family: Forte, serif; }</style><defs><linearGradient id="gradient"><stop/><stop/></linearGradient><pattern id="pattern" width="4" height="5"/><filter id="blur"><feGaussianBlur/></filter></defs><g id="layer" inkscape:groupmode="layer" inkscape:label="Main" sodipodi:insensitive="true" style="display:none"><rect id="rect_first" fill="url(#gradient)" stroke="url(#pattern)" filter="url(#blur)" opacity="0.5"/><rect id="rect_second"/><rect id="rect_third"/><circle/><text class="label">SENSITIVE DOCUMENT CONTENT</text><use href="#missing"/></g><image href="private/assets/secret.png" width="12"/><image href="https://example.test/private.png"/><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"/></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireInventory(result, label) {
  if (result.isError || result.structuredContent?.inventory === undefined)
    throw new Error(`${label} did not return an inventory`);
  return result.structuredContent.inventory;
}

const client = new Client(
  { name: "inkscape-mcp-f04-inventory", version: packageMetadata.version },
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

  const path = "f04-inventory.svg";
  await writeFile(join(workspaceRoot, path), source, "utf8");
  const before = revision(await readFile(join(workspaceRoot, path)));
  const deep = await client.callTool({
    arguments: {
      inventoryLimit: 1000,
      level: "deep",
      path,
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const inventory = requireInventory(deep, "deep inspection");
  if (
    inventory.definitions?.gradients?.length !== 1 ||
    inventory.definitions?.patterns?.length !== 1 ||
    inventory.definitions?.filters?.length !== 1 ||
    inventory.images?.map((image) => image.kind).join(",") !==
      "linked,external,embedded" ||
    inventory.layers?.[0]?.locked !== true ||
    inventory.layers?.[0]?.visibility !== "hidden" ||
    inventory.fontFamilies?.join(",") !== "Forte,serif" ||
    inventory.fontResolution !== "unavailable" ||
    inventory.duplicateIds?.length !== 0 ||
    inventory.unknownNamespaces?.join(",") !== "urn:private" ||
    inventory.unresolvedReferences?.join(",") !== "missing" ||
    inventory.typeCounts?.circle !== 1 ||
    inventory.ids?.includes("SENSITIVE DOCUMENT CONTENT") ||
    !inventory.ids?.includes("rect_first")
  )
    throw new Error("deep inspection did not cover the complete inventory");
  const serialized = JSON.stringify(deep.structuredContent);
  if (
    serialized.includes("SENSITIVE DOCUMENT CONTENT") ||
    serialized.includes("private/assets/secret.png") ||
    serialized.includes("example.test/private.png")
  )
    throw new Error("document_inspect leaked SVG content or image references");

  const pages = [];
  for (const offset of [0, 1, 2]) {
    const result = await client.callTool({
      arguments: {
        inventoryKinds: ["rect"],
        inventoryLimit: 1,
        inventoryOffset: offset,
        level: "standard",
        path,
        workspaceId: workspace.id,
      },
      name: "document_inspect",
    });
    pages.push(requireInventory(result, `inventory page ${offset}`));
  }
  if (
    pages.map((page) => page.ids?.[0]).join(",") !==
      "rect_first,rect_second,rect_third" ||
    pages.map((page) => page.nextOffset ?? "end").join(",") !== "1,2,end" ||
    pages[0]?.totalElementCount !== 3 ||
    pages.some((page) => page.typeCounts?.rect !== 3)
  )
    throw new Error("document_inspect inventory pagination was not stable");
  if (revision(await readFile(join(workspaceRoot, path))) !== before)
    throw new Error("document_inspect modified the inspected document");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F04 inventory MCP checks passed.\n");
