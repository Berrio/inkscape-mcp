import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = {
  args: ["dist/cli.js"],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};

for (const versionNegotiation of [
  { mode: { pin: "2026-07-28" } },
  { mode: "legacy" },
]) {
  const client = new Client(
    { name: "inkscape-mcp-test-client", version: "0.0.0" },
    { versionNegotiation },
  );
  const transport = new StdioClientTransport(server);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    if (!tools.some((tool) => tool.name === "inkscape_status")) {
      throw new Error("inkscape_status is not listed");
    }
    const result = await client.callTool({
      arguments: {},
      name: "inkscape_status",
    });
    if (result.isError || result.structuredContent === undefined) {
      throw new Error("inkscape_status did not return structured content");
    }
  } finally {
    await client.close();
  }
}

const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-mcp-test-"));
const workspaceTransport = new StdioClientTransport({
  ...server,
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
});
const workspaceClient = new Client(
  { name: "inkscape-mcp-workspace-client", version: "0.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
try {
  await workspaceClient.connect(workspaceTransport);
  const workspaceResult = await workspaceClient.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = workspaceResult.structuredContent?.workspaces?.[0];
  if (!workspace || typeof workspace.id !== "string") {
    throw new Error("workspace_list did not return an opaque workspace ID");
  }
  await writeFile(
    join(workspaceRoot, "percentage.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="50%" viewBox="0 0 20 10"/>',
  );
  const percentageInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "percentage.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const percentageRevision = percentageInspection.structuredContent?.revision;
  if (
    percentageInspection.isError ||
    percentageInspection.structuredContent?.ambiguousViewport !== true ||
    !percentageInspection.structuredContent?.warnings?.includes(
      "VIEWPORT_WIDTH_PERCENTAGE_UNRESOLVED",
    ) ||
    typeof percentageRevision !== "string"
  ) {
    throw new Error("document_inspect did not expose ambiguous percentages");
  }
  const percentageResize = await workspaceClient.callTool({
    arguments: {
      expectedRevision: percentageRevision,
      height: 100,
      path: "percentage.svg",
      unit: "px",
      width: 200,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (!percentageResize.isError) {
    throw new Error(
      "document_resize accepted an ambiguous percentage viewport",
    );
  }
  await writeFile(
    join(workspaceRoot, "fit.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="fit_rect" x="10" y="5" width="30" height="20"/></svg>',
  );
  const fitInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "fit.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const fitRevision = fitInspection.structuredContent?.revision;
  if (fitInspection.isError || typeof fitRevision !== "string") {
    throw new Error("document_inspect did not prepare the fit fixture");
  }
  const fitted = await workspaceClient.callTool({
    arguments: {
      expectedRevision: fitRevision,
      ids: ["fit_rect"],
      margins: { bottom: 3, left: 5, right: 5, top: 2 },
      path: "fit.svg",
      scope: "selection",
      unit: "mm",
      workspaceId: workspace.id,
    },
    name: "document_fit_page",
  });
  const fittedRevision = fitted.structuredContent?.revision;
  if (
    fitted.isError ||
    fitted.structuredContent?.boundsFidelity !== "partial" ||
    !fitted.structuredContent?.warnings?.includes("FIT_USED_VISUAL_BOUNDS") ||
    typeof fittedRevision !== "string"
  ) {
    throw new Error("document_fit_page did not fit selected visual bounds");
  }
  const cropped = await workspaceClient.callTool({
    arguments: {
      action: "crop",
      expectedRevision: fittedRevision,
      margins: { bottom: 1, left: 1, right: 1, top: 1 },
      path: "fit.svg",
      unit: "mm",
      workspaceId: workspace.id,
    },
    name: "document_page_adjust",
  });
  const croppedRevision = cropped.structuredContent?.revision;
  if (
    cropped.isError ||
    !cropped.structuredContent?.warnings?.includes("PAGE_CROPPED") ||
    typeof croppedRevision !== "string"
  ) {
    throw new Error("document_page_adjust did not crop the page");
  }
  const oriented = await workspaceClient.callTool({
    arguments: {
      action: "toggle_orientation",
      expectedRevision: croppedRevision,
      path: "fit.svg",
      unit: "mm",
      workspaceId: workspace.id,
    },
    name: "document_page_adjust",
  });
  if (
    oriented.isError ||
    !oriented.structuredContent?.warnings?.includes("PAGE_ORIENTATION_CHANGED")
  ) {
    throw new Error("document_page_adjust did not change orientation");
  }
  const created = await workspaceClient.callTool({
    arguments: {
      outputPath: "a4.svg",
      pages: [{ height: 297, id: "page_front", width: 210, x: 0, y: 0 }],
      preset: "a4-portrait",
      workspaceId: workspace.id,
    },
    name: "document_create",
  });
  if (
    created.isError ||
    !(await readFile(join(workspaceRoot, "a4.svg"), "utf8")).includes(
      'width="210mm"',
    )
  ) {
    throw new Error("document_create did not publish the expected A4 SVG");
  }
  const revision = created.structuredContent?.revision;
  if (typeof revision !== "string") {
    throw new Error("document_create did not return a revision");
  }
  const snapshot = await workspaceClient.callTool({
    arguments: {
      expectedRevision: revision,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_snapshot",
  });
  const snapshotId = snapshot.structuredContent?.snapshotId;
  if (snapshot.isError || typeof snapshotId !== "string") {
    throw new Error("document_snapshot did not return an opaque snapshot ID");
  }
  const resized = await workspaceClient.callTool({
    arguments: {
      expectedRevision: revision,
      height: 210,
      path: "a4.svg",
      unit: "mm",
      width: 148,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    resized.isError ||
    !(await readFile(join(workspaceRoot, "a4.svg"), "utf8")).includes(
      'viewBox="0 0 148 210"',
    )
  ) {
    throw new Error("document_resize did not apply page_only semantics");
  }
  const resizedRevision = resized.structuredContent?.revision;
  if (typeof resizedRevision !== "string") {
    throw new Error("document_resize did not return a revision");
  }
  const restored = await workspaceClient.callTool({
    arguments: {
      expectedRevision: resizedRevision,
      path: "a4.svg",
      snapshotId,
      workspaceId: workspace.id,
    },
    name: "document_restore",
  });
  const restoredRevision = restored.structuredContent?.revision;
  if (
    restored.isError ||
    restored.structuredContent?.backupCreated !== true ||
    restoredRevision !== revision
  ) {
    throw new Error("document_restore did not restore the snapshot atomically");
  }
  const resizedAgain = await workspaceClient.callTool({
    arguments: {
      expectedRevision: restoredRevision,
      height: 210,
      path: "a4.svg",
      unit: "mm",
      width: 148,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  const resizedAgainRevision = resizedAgain.structuredContent?.revision;
  if (resizedAgain.isError || typeof resizedAgainRevision !== "string") {
    throw new Error("document_resize did not resize a restored document");
  }
  const resizeDryRun = await workspaceClient.callTool({
    arguments: {
      dryRun: true,
      expectedRevision: resizedAgainRevision,
      height: 100,
      mode: "scale_content_contain",
      path: "a4.svg",
      unit: "mm",
      width: 100,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    resizeDryRun.isError ||
    resizeDryRun.structuredContent?.dryRun !== true ||
    !resizeDryRun.structuredContent?.predicted?.transform ||
    resizeDryRun.structuredContent?.revision !== resizedAgainRevision ||
    !(await readFile(join(workspaceRoot, "a4.svg"), "utf8")).includes(
      'viewBox="0 0 148 210"',
    )
  ) {
    throw new Error("document_resize dryRun did not predict without mutation");
  }
  const elements = await workspaceClient.callTool({
    arguments: {
      elements: [
        { id: "layer_main", kind: "layer", label: "Main" },
        {
          height: 50,
          id: "demo_rect",
          kind: "rect",
          parentId: "layer_main",
          style: { fill: "#ff0000" },
          width: 50,
          x: 20,
          y: 20,
        },
        {
          id: "demo_text",
          kind: "text",
          parentId: "layer_main",
          style: { fill: "#000000", fontSize: 12 },
          text: "MCP",
          x: 30,
          y: 90,
        },
        { cx: 90, cy: 30, id: "temporary_circle", kind: "circle", r: 5 },
        {
          d: "M 80 80 L 100 100",
          id: "demo_path",
          kind: "path",
          parentId: "layer_main",
          style: { stroke: "#000000", strokeWidth: 1 },
        },
        {
          cx: 120,
          cy: 50,
          id: "demo_star",
          kind: "star",
          points: 5,
          r1: 10,
          r2: 5,
          style: { fill: "#0000ff" },
        },
      ],
      expectedRevision: resizedAgainRevision,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_create",
  });
  const elementsRevision = elements.structuredContent?.revision;
  if (
    elements.isError ||
    elements.structuredContent?.ids?.[0] !== "layer_main" ||
    elements.structuredContent?.ids?.[1] !== "demo_rect" ||
    elements.structuredContent?.ids?.[2] !== "demo_text" ||
    elements.structuredContent?.ids?.[3] !== "temporary_circle" ||
    elements.structuredContent?.ids?.[4] !== "demo_path" ||
    elements.structuredContent?.ids?.[5] !== "demo_star" ||
    typeof elementsRevision !== "string"
  ) {
    throw new Error("elements_create did not publish a typed rectangle");
  }
  const deleted = await workspaceClient.callTool({
    arguments: {
      expectedRevision: elementsRevision,
      ids: ["temporary_circle"],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_delete",
  });
  const deletedRevision = deleted.structuredContent?.revision;
  if (
    deleted.isError ||
    deleted.structuredContent?.deletedIds?.[0] !== "temporary_circle" ||
    typeof deletedRevision !== "string"
  ) {
    throw new Error("elements_delete did not remove the selected element");
  }
  const transformed = await workspaceClient.callTool({
    arguments: {
      expectedRevision: deletedRevision,
      ids: ["demo_rect", "demo_text"],
      path: "a4.svg",
      transform: { kind: "translate", x: 5, y: 10 },
      workspaceId: workspace.id,
    },
    name: "elements_transform",
  });
  const transformedRevision = transformed.structuredContent?.revision;
  if (
    transformed.isError ||
    transformed.structuredContent?.ids?.length !== 2 ||
    typeof transformedRevision !== "string"
  ) {
    throw new Error(
      "elements_transform did not apply an allowlisted transform",
    );
  }
  const boundsWithoutRevision = await workspaceClient.callTool({
    arguments: {
      includeBounds: true,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_query",
  });
  if (!boundsWithoutRevision.isError) {
    throw new Error(
      "elements_query accepted a native bounds request without revision",
    );
  }
  const queried = await workspaceClient.callTool({
    arguments: {
      ids: ["demo_rect", "temporary_circle"],
      expectedRevision: transformedRevision,
      includeBounds: true,
      layerId: "layer_main",
      path: "a4.svg",
      selector: "#demo_rect",
      workspaceId: workspace.id,
    },
    name: "elements_query",
  });
  if (
    queried.isError ||
    queried.structuredContent?.elements?.[0]?.id !== "demo_rect" ||
    typeof queried.structuredContent?.elements?.[0]?.bounds?.width !==
      "number" ||
    queried.structuredContent?.elements?.[0]?.bounds?.kind !== "visual" ||
    queried.structuredContent?.elements?.[0]?.bounds?.fidelity !== "partial" ||
    queried.structuredContent?.missingIds?.[0] !== "temporary_circle"
  ) {
    throw new Error("elements_query did not return a bounded SVG summary");
  }
  const updated = await workspaceClient.callTool({
    arguments: {
      elements: [
        {
          geometry: { kind: "rect", width: 45 },
          id: "demo_rect",
          style: { fill: "#00ff00" },
        },
        { id: "demo_text", text: "Updated from MCP" },
      ],
      expectedRevision: transformedRevision,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_update",
  });
  const updatedRevision = updated.structuredContent?.revision;
  if (
    updated.isError ||
    updated.structuredContent?.ids?.length !== 2 ||
    typeof updatedRevision !== "string"
  ) {
    throw new Error("elements_update did not apply typed patches");
  }
  const arranged = await workspaceClient.callTool({
    arguments: {
      action: "front",
      expectedRevision: updatedRevision,
      ids: ["demo_rect"],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_arrange",
  });
  const arrangedRevision = arranged.structuredContent?.revision;
  if (
    arranged.isError ||
    arranged.structuredContent?.action !== "front" ||
    typeof arrangedRevision !== "string"
  ) {
    throw new Error("elements_arrange did not apply a typed z-order change");
  }
  const grouped = await workspaceClient.callTool({
    arguments: {
      action: "group",
      expectedRevision: arrangedRevision,
      groupId: "demo_group",
      ids: ["demo_rect", "demo_text"],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_group",
  });
  const groupedRevision = grouped.structuredContent?.revision;
  if (grouped.isError || typeof groupedRevision !== "string") {
    throw new Error("elements_group did not create a typed SVG group");
  }
  const inspected = await workspaceClient.callTool({
    arguments: {
      expectedRevision: groupedRevision,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  if (
    inspected.isError ||
    inspected.structuredContent?.viewBox?.width !== 148 ||
    inspected.structuredContent?.widthUnit !== "mm" ||
    (inspected.structuredContent?.inventory?.elementCount ?? 0) < 2 ||
    inspected.structuredContent?.pages?.[0]?.id !== "page_front"
  ) {
    throw new Error("document_inspect did not report the resized viewBox");
  }
  const preflight = await workspaceClient.callTool({
    arguments: { path: "a4.svg", profile: "web", workspaceId: workspace.id },
    name: "document_preflight",
  });
  if (
    preflight.isError ||
    preflight.structuredContent?.valid !== true ||
    preflight.structuredContent?.profile !== "web"
  ) {
    throw new Error("document_preflight did not run the requested profile");
  }
  const pageAdded = await workspaceClient.callTool({
    arguments: {
      action: "add",
      expectedRevision: groupedRevision,
      page: { height: 210, id: "page_back", width: 148, x: 160, y: 0 },
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_pages",
  });
  if (pageAdded.isError || pageAdded.structuredContent?.pages?.length !== 2) {
    throw new Error("document_pages did not create and add explicit pages");
  }
  const pagesRevision = pageAdded.structuredContent?.revision;
  if (typeof pagesRevision !== "string") {
    throw new Error("document_pages did not return a revision");
  }
  const pageValidation = await workspaceClient.callTool({
    arguments: {
      expectedRevision: pagesRevision,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_page_validate",
  });
  if (
    pageValidation.isError ||
    pageValidation.structuredContent?.boundsFidelity !== "partial" ||
    !pageValidation.structuredContent?.validation?.outsideObjectIds?.includes(
      "demo_path",
    ) ||
    (pageValidation.structuredContent?.validation?.overlaps?.length ?? 0) < 1
  ) {
    throw new Error("document_page_validate did not report page layout risks");
  }
  const pages = await workspaceClient.callTool({
    arguments: { action: "list", path: "a4.svg", workspaceId: workspace.id },
    name: "document_pages",
  });
  if (
    pages.isError ||
    pages.structuredContent?.pages?.[1]?.id !== "page_back"
  ) {
    throw new Error("document_pages did not list its stable page ID");
  }
  const settings = await workspaceClient.callTool({
    arguments: {
      expectedRevision: pagesRevision,
      path: "a4.svg",
      settings: { pageColor: "#abcdef", pageOpacity: 0.5 },
      workspaceId: workspace.id,
    },
    name: "document_settings",
  });
  if (
    settings.isError ||
    settings.structuredContent?.settings?.pageOpacity !== 0.5
  ) {
    throw new Error("document_settings did not persist a typed page opacity");
  }
  const settingsRevision = settings.structuredContent?.revision;
  if (typeof settingsRevision !== "string") {
    throw new Error("document_settings did not return a revision");
  }
  const preview = await workspaceClient.callTool({
    arguments: {
      area: "drawing",
      expectedRevision: settingsRevision,
      outputPath: "a4-preview.png",
      path: "a4.svg",
      width: 256,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (
    preview.isError ||
    preview.structuredContent?.documentPath !== "a4-preview.png" ||
    preview.structuredContent?.width !== 256 ||
    typeof preview.structuredContent?.artifact?.uri !== "string"
  ) {
    throw new Error("document_render_preview did not render a bounded PNG");
  }
  const artifactUri = preview.structuredContent.artifact.uri;
  const resourceTemplates = await workspaceClient.listResourceTemplates();
  if (
    !resourceTemplates.resourceTemplates.some(
      (resource) => resource.uriTemplate === "inkscape://artifact/{id}",
    )
  ) {
    throw new Error("artifact resource template is not advertised");
  }
  const firstArtifactChunk = await workspaceClient.readResource({
    uri: artifactUri,
  });
  const laterArtifactChunk = await workspaceClient.readResource({
    uri: `${artifactUri}/chunk/1`,
  });
  if (
    typeof firstArtifactChunk.contents[0]?.blob !== "string" ||
    typeof laterArtifactChunk.contents[0]?.blob !== "string" ||
    Buffer.from(firstArtifactChunk.contents[0].blob, "base64").byteLength === 0
  ) {
    throw new Error("artifact resources did not serve bounded binary chunks");
  }
  const exported = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      outputPath: "a4.png",
      path: "a4.svg",
      width: 400,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (exported.isError || exported.structuredContent?.width !== 400) {
    throw new Error("export_png did not publish the expected PNG");
  }
  const dpiPng = await workspaceClient.callTool({
    arguments: {
      dpi: 144,
      expectedRevision: settingsRevision,
      outputPath: "a4-144dpi.png",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (dpiPng.isError || (dpiPng.structuredContent?.width ?? 0) < 1) {
    throw new Error("export_png did not accept a bounded DPI request");
  }
  const solidPng = await workspaceClient.callTool({
    arguments: {
      area: "drawing",
      background: "solid",
      backgroundColor: "#ff0000",
      expectedRevision: settingsRevision,
      outputPath: "a4-solid.png",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    solidPng.isError ||
    solidPng.structuredContent?.background !== "solid" ||
    solidPng.structuredContent?.area !== "drawing"
  ) {
    throw new Error("export_png did not apply area and background requests");
  }
  const pdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      outputPath: "a4.pdf",
      path: "a4.svg",
      pdfVersion: "1.5",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    pdf.isError ||
    pdf.structuredContent?.version !== "1.5" ||
    (pdf.structuredContent?.pageCount ?? 0) < 1
  ) {
    throw new Error("export_pdf did not publish an inspectable PDF");
  }
  const plainSvg = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      flavor: "plain",
      outputPath: "a4-plain.svg",
      path: "a4.svg",
      textToPath: true,
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  if (
    plainSvg.isError ||
    plainSvg.structuredContent?.flavor !== "plain" ||
    !plainSvg.structuredContent?.warnings?.includes("TEXT_CONVERTED_TO_PATHS")
  ) {
    throw new Error(
      "export_svg did not publish the expected plain SVG warning",
    );
  }
  const contained = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      height: 297,
      mode: "scale_content_contain",
      path: "a4.svg",
      unit: "mm",
      width: 297,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    contained.isError ||
    typeof contained.structuredContent?.revision !== "string"
  ) {
    throw new Error("document_resize did not apply scale_content_contain");
  }
} finally {
  await workspaceClient.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("MCP modern and legacy stdio checks passed.\n");
