import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = {
  args: ["dist/cli.js"],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const isWithin = (actual, expected, tolerance = 0.6) =>
  Math.abs(actual - expected) <= tolerance;

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
      includeComputedStyle: true,
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
    queried.structuredContent?.elements?.[0]?.computedStyle?.properties
      ?.fill !== "#ff0000" ||
    queried.structuredContent?.elements?.[0]?.computedStyle?.fidelity !==
      "exact-supported" ||
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
      includeVisualBounds: true,
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
    inspected.structuredContent?.pages?.[0]?.id !== "page_front" ||
    inspected.structuredContent?.visualBounds?.fidelity !== "partial" ||
    inspected.structuredContent?.visualBounds?.source !==
      "inkscape-query-all" ||
    inspected.structuredContent?.visualBounds?.pages?.[0]?.id !== "page_front"
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
  const printPreflight = await workspaceClient.callTool({
    arguments: {
      bleed: {
        behavior: "metadata-only",
        bottom: { unit: "mm", value: 3 },
        left: { unit: "mm", value: 3 },
        right: { unit: "mm", value: 3 },
        top: { unit: "mm", value: 3 },
      },
      path: "a4.svg",
      profile: "print",
      workspaceId: workspace.id,
    },
    name: "document_preflight",
  });
  if (
    printPreflight.isError ||
    printPreflight.structuredContent?.print?.bleed?.requiredMm?.top !== 3 ||
    printPreflight.structuredContent?.print?.bleed?.presentMm?.top !== 0
  ) {
    throw new Error(
      "document_preflight did not return a typed print bleed report",
    );
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
  const cachedPreview = await workspaceClient.callTool({
    arguments: {
      area: "drawing",
      expectedRevision: settingsRevision,
      outputPath: "a4-preview-cached.png",
      path: "a4.svg",
      width: 256,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (
    cachedPreview.isError ||
    cachedPreview.structuredContent?.cache !== "hit" ||
    cachedPreview.structuredContent?.area !== "drawing"
  ) {
    throw new Error("document_render_preview did not reuse its revision cache");
  }
  const selectionPreview = await workspaceClient.callTool({
    arguments: {
      area: "selection",
      expectedRevision: settingsRevision,
      outputPath: "a4-preview-selection.png",
      path: "a4.svg",
      selectionId: "demo_rect",
      width: 128,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (
    selectionPreview.isError ||
    selectionPreview.structuredContent?.area !== "selection" ||
    selectionPreview.structuredContent?.selectionId !== "demo_rect"
  ) {
    throw new Error(
      "document_render_preview did not render the typed selection",
    );
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
  if (
    exported.isError ||
    exported.structuredContent?.width !== 400 ||
    exported.structuredContent?.bitDepth !== 8
  ) {
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
  const printDocument = await workspaceClient.callTool({
    arguments: {
      outputPath: "a4-print.svg",
      preset: "a4-portrait",
      workspaceId: workspace.id,
    },
    name: "document_create",
  });
  const printRevision = printDocument.structuredContent?.revision;
  if (printDocument.isError || typeof printRevision !== "string")
    throw new Error("document_create did not prepare the A4 print fixture");
  const printPng = await workspaceClient.callTool({
    arguments: {
      dpi: 300,
      expectedRevision: printRevision,
      outputPath: "a4-300dpi.png",
      path: "a4-print.svg",
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    printPng.isError ||
    printPng.structuredContent?.width !== 2480 ||
    printPng.structuredContent?.height !== 3508
  ) {
    throw new Error("A4 300 DPI PNG did not produce 2480 by 3508 pixels");
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
  const selectionPng = await workspaceClient.callTool({
    arguments: {
      area: "selection",
      expectedRevision: settingsRevision,
      outputPath: "a4-selection.png",
      path: "a4.svg",
      selectionId: "demo_rect",
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    selectionPng.isError ||
    selectionPng.structuredContent?.area !== "selection" ||
    selectionPng.structuredContent?.selectionId !== "demo_rect"
  ) {
    throw new Error("export_png did not export the typed selection area");
  }
  const customPng = await workspaceClient.callTool({
    arguments: {
      area: "custom",
      customArea: { height: 20, width: 20, x: 0, y: 0 },
      expectedRevision: settingsRevision,
      outputPath: "a4-custom.png",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (customPng.isError || customPng.structuredContent?.area !== "custom") {
    throw new Error("export_png did not export a typed custom area");
  }
  const advancedPng = await workspaceClient.callTool({
    arguments: {
      antialias: 3,
      background: "transparent",
      colorMode: "RGBA_16",
      compression: 9,
      dithering: true,
      expectedRevision: settingsRevision,
      outputPath: "a4-\u00f1-16bit.png",
      path: "a4.svg",
      snapAreaToPixels: true,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    advancedPng.isError ||
    advancedPng.structuredContent?.bitDepth !== 16 ||
    advancedPng.structuredContent?.colorType !== 6 ||
    advancedPng.structuredContent?.background !== "transparent"
  ) {
    throw new Error(
      "export_png did not gate and verify advanced 16-bit PNG options",
    );
  }
  const punctuationPng = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      outputPath: "salida ñ; & segura.png",
      path: "a4.svg",
      width: 64,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    punctuationPng.isError ||
    punctuationPng.structuredContent?.width !== 64 ||
    !(await readFile(join(workspaceRoot, "salida ñ; & segura.png")))
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error("export_png did not preserve a Unicode metacharacter path");
  }
  const unavailableFilterDpi = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      filterDpi: 150,
      outputPath: "a4-filter-dpi.pdf",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (!unavailableFilterDpi.isError) {
    throw new Error("export_pdf accepted filter DPI absent from Inkscape help");
  }
  const pdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      filters: "ignore",
      outputPath: "a4.pdf",
      path: "a4.svg",
      pdfVersion: "1.5",
      textToPath: true,
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    pdf.isError ||
    pdf.structuredContent?.version !== "1.5" ||
    (pdf.structuredContent?.pageCount ?? 0) < 1 ||
    typeof pdf.structuredContent?.hash !== "string" ||
    pdf.structuredContent?.cropBoxes?.length !==
      pdf.structuredContent?.pageCount ||
    !pdf.structuredContent?.warnings?.includes(
      "FILTERS_IGNORED_VISUAL_CHANGE",
    ) ||
    !pdf.structuredContent?.warnings?.includes("TEXT_CONVERTED_TO_PATHS")
  ) {
    throw new Error("export_pdf did not publish an inspectable PDF");
  }
  const marginPdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      margin: {
        bottom: { unit: "mm", value: 5 },
        left: { unit: "mm", value: 5 },
        right: { unit: "mm", value: 5 },
        top: { unit: "mm", value: 5 },
      },
      outputPath: "a4-margin.pdf",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    marginPdf.isError ||
    !isWithin(marginPdf.structuredContent?.mediaBoxes?.[0]?.width ?? 0, 624) ||
    !isWithin(marginPdf.structuredContent?.mediaBoxes?.[0]?.height ?? 0, 871) ||
    !marginPdf.structuredContent?.warnings?.includes(
      "PDF_MARGIN_EXPANDED_TEMPORARY",
    )
  ) {
    throw new Error(
      "export_pdf did not verify its temporary PDF margin expansion",
    );
  }
  const latexPdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      latex: true,
      outputPath: "a4-latex.pdf",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    latexPdf.isError ||
    latexPdf.structuredContent?.latexSidecar?.path !== "a4-latex.pdf_tex" ||
    typeof latexPdf.structuredContent?.latexSidecar?.revision !== "string" ||
    !latexPdf.structuredContent?.warnings?.includes("LATEX_SIDECAR_EMITTED")
  ) {
    throw new Error("export_pdf did not publish its LaTeX sidecar");
  }
  const latexSidecar = await readFile(join(workspaceRoot, "a4-latex.pdf_tex"));
  if (latexSidecar.byteLength < 1)
    throw new Error("export_pdf published an empty LaTeX sidecar");
  await writeFile(
    join(workspaceRoot, "multipage.svg"),
    await readFile(
      join(process.cwd(), "tests", "fixtures", "pdf-multipage.svg"),
    ),
  );
  const multipageInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "multipage.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const multipageRevision = multipageInspection.structuredContent?.revision;
  if (multipageInspection.isError || typeof multipageRevision !== "string") {
    throw new Error(
      "document_inspect did not prepare the PDF multipage fixture",
    );
  }
  const multipagePdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: multipageRevision,
      outputPath: "multipage.pdf",
      path: "multipage.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    multipagePdf.isError ||
    multipagePdf.structuredContent?.pageCount !== 2 ||
    multipagePdf.structuredContent?.strategy !== "full_document" ||
    !isWithin(
      multipagePdf.structuredContent.mediaBoxes?.[0]?.width ?? 0,
      284,
    ) ||
    !isWithin(multipagePdf.structuredContent.mediaBoxes?.[1]?.width ?? 0, 142)
  ) {
    throw new Error("export_pdf did not preserve a multipage PDF document");
  }
  const subsetPdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: multipageRevision,
      outputPath: "multipage-extra.pdf",
      pageIds: ["page_extra"],
      path: "multipage.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    subsetPdf.isError ||
    subsetPdf.structuredContent?.pageCount !== 1 ||
    subsetPdf.structuredContent?.strategy !== "prune_subset" ||
    subsetPdf.structuredContent?.pageIds?.[0] !== "page_extra" ||
    !subsetPdf.structuredContent?.warnings?.includes("PDF_SUBSET_PRUNED")
  ) {
    throw new Error("export_pdf did not create a pruned PDF subset");
  }
  const orderedSubsetPdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: multipageRevision,
      outputPath: "multipage-reordered.pdf",
      pageIds: ["page_extra", "page_back"],
      path: "multipage.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    orderedSubsetPdf.isError ||
    orderedSubsetPdf.structuredContent?.pageCount !== 2 ||
    orderedSubsetPdf.structuredContent?.pageIds?.join(",") !==
      "page_extra,page_back" ||
    !isWithin(
      orderedSubsetPdf.structuredContent.mediaBoxes?.[0]?.width ?? 0,
      142,
    ) ||
    !isWithin(
      orderedSubsetPdf.structuredContent.mediaBoxes?.[1]?.width ?? 0,
      284,
    )
  ) {
    throw new Error("export_pdf did not preserve the requested subset order");
  }
  await mkdir(join(workspaceRoot, "separate-pages"));
  const separatePages = await workspaceClient.callTool({
    arguments: {
      expectedRevision: multipageRevision,
      outputDirectory: "separate-pages",
      pageIds: ["page_extra", "page_back"],
      path: "multipage.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf_pages",
  });
  if (
    separatePages.isError ||
    separatePages.structuredContent?.strategy !== "prune_each_page" ||
    separatePages.structuredContent?.pages?.length !== 2 ||
    separatePages.structuredContent.pages[0]?.outputPath !==
      "separate-pages/page-002.pdf" ||
    separatePages.structuredContent.pages[1]?.outputPath !==
      "separate-pages/page-001.pdf" ||
    separatePages.structuredContent.pages.some(
      (page) =>
        page.cropBox.width <= 0 ||
        page.mediaBox.height <= 0 ||
        page.mediaBox.width <= 0,
    )
  ) {
    throw new Error("export_pdf_pages did not create deterministic PDFs");
  }
  await Promise.all(
    ["page-001.pdf", "page-002.pdf"].map(async (name) => {
      const bytes = await readFile(join(workspaceRoot, "separate-pages", name));
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("export_pdf_pages did not write a PDF output");
    }),
  );
  await writeFile(
    join(workspaceRoot, "nonzero-viewbox.svg"),
    await readFile(
      join(process.cwd(), "tests", "fixtures", "pdf-nonzero-viewbox.svg"),
    ),
  );
  const nonzeroInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "nonzero-viewbox.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const nonzeroRevision = nonzeroInspection.structuredContent?.revision;
  if (nonzeroInspection.isError || typeof nonzeroRevision !== "string")
    throw new Error(
      "document_inspect did not prepare the nonzero viewBox fixture",
    );
  const nonzeroPdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: nonzeroRevision,
      outputPath: "nonzero-viewbox.pdf",
      path: "nonzero-viewbox.svg",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (
    nonzeroPdf.isError ||
    nonzeroPdf.structuredContent?.pageCount !== 1 ||
    !isWithin(nonzeroPdf.structuredContent.mediaBoxes?.[0]?.width ?? 0, 284) ||
    !isWithin(nonzeroPdf.structuredContent.mediaBoxes?.[0]?.height ?? 0, 142) ||
    !isWithin(nonzeroPdf.structuredContent.cropBoxes?.[0]?.width ?? 0, 284) ||
    !isWithin(nonzeroPdf.structuredContent.cropBoxes?.[0]?.height ?? 0, 142)
  ) {
    throw new Error(
      "export_pdf did not preserve the nonzero viewBox PDF boxes",
    );
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
  const genericExport = await workspaceClient.callTool({
    arguments: {
      spec: {
        area: { kind: "page" },
        background: { mode: "transparent" },
        format: "png",
        source: { expectedRevision: settingsRevision, path: "a4.svg" },
        target: {
          kind: "file",
          overwrite: false,
          path: "a4-generic.png",
        },
      },
      workspaceId: workspace.id,
    },
    name: "document_export",
  });
  if (
    genericExport.isError ||
    genericExport.structuredContent?.format !== "png" ||
    genericExport.structuredContent?.outputPath !== "a4-generic.png" ||
    typeof genericExport.structuredContent?.artifact?.uri !== "string"
  ) {
    throw new Error("document_export did not publish the generic PNG export");
  }
  const genericPdf = await workspaceClient.callTool({
    arguments: {
      spec: {
        area: { kind: "document" },
        filters: "preserve",
        format: "pdf",
        source: { expectedRevision: settingsRevision, path: "a4.svg" },
        target: {
          kind: "file",
          overwrite: false,
          path: "a4-generic.pdf",
        },
        text: "preserve",
      },
      workspaceId: workspace.id,
    },
    name: "document_export",
  });
  if (
    genericPdf.isError ||
    genericPdf.structuredContent?.format !== "pdf" ||
    genericPdf.structuredContent?.outputPath !== "a4-generic.pdf" ||
    typeof genericPdf.structuredContent?.artifact?.uri !== "string"
  ) {
    throw new Error("document_export did not publish the generic PDF export");
  }
  const genericBatch = await workspaceClient.callTool({
    arguments: {
      mode: "all_or_nothing",
      specs: [
        {
          area: { kind: "page" },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: { kind: "file", overwrite: false, path: "batch-one.png" },
        },
        {
          area: { kind: "drawing" },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: { kind: "file", overwrite: false, path: "batch-two.png" },
        },
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  if (
    genericBatch.isError ||
    genericBatch.structuredContent?.successes?.length !== 2 ||
    genericBatch.structuredContent?.failures?.length !== 0 ||
    genericBatch.structuredContent?.manifest?.publication !==
      "file_commit_batch" ||
    genericBatch.structuredContent.manifest.variants.length !== 2 ||
    typeof genericBatch.structuredContent.manifest.inkscapeVersion !== "string"
  ) {
    throw new Error(
      "document_export_batch did not publish both PNG variants and its manifest",
    );
  }
  const presetBatch = await workspaceClient.callTool({
    arguments: {
      mode: "all_or_nothing",
      preset: {
        name: "web-png",
        outputDirectory: "preset-web",
        source: { expectedRevision: settingsRevision, path: "a4.svg" },
      },
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  if (
    presetBatch.isError ||
    presetBatch.structuredContent?.successes?.length !== 1 ||
    presetBatch.structuredContent.successes[0]?.outputPath !==
      "preset-web/web-1200.png"
  ) {
    throw new Error("document_export_batch did not expand the web PNG preset");
  }
  const rejectedAtomicBatch = await workspaceClient.callTool({
    arguments: {
      mode: "all_or_nothing",
      specs: [
        {
          area: { kind: "drawing" },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: {
            kind: "file",
            overwrite: false,
            path: "must-not-publish.png",
          },
        },
        {
          area: {
            elementIds: ["missing_selection"],
            kind: "selection",
            output: "combined",
            visibility: "document",
          },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: {
            kind: "file",
            overwrite: false,
            path: "will-fail.png",
          },
        },
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  const atomicOutputExists = await readFile(
    join(workspaceRoot, "must-not-publish.png"),
  )
    .then(() => true)
    .catch(() => false);
  if (!rejectedAtomicBatch.isError || atomicOutputExists) {
    throw new Error("all_or_nothing batch published a variant after failure");
  }
  const bestEffortBatch = await workspaceClient.callTool({
    arguments: {
      mode: "best_effort",
      specs: [
        {
          area: {
            elementIds: ["missing_selection"],
            kind: "selection",
            output: "combined",
            visibility: "document",
          },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: { kind: "file", overwrite: false, path: "will-fail.png" },
        },
        {
          area: { kind: "drawing" },
          background: { mode: "transparent" },
          format: "png",
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: {
            kind: "file",
            overwrite: false,
            path: "best-effort-succeeds.png",
          },
        },
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  if (
    bestEffortBatch.isError ||
    bestEffortBatch.structuredContent?.failures?.length !== 1 ||
    bestEffortBatch.structuredContent.failures[0]?.index !== 0 ||
    bestEffortBatch.structuredContent.successes?.length !== 1 ||
    bestEffortBatch.structuredContent.successes[0]?.index !== 1 ||
    bestEffortBatch.structuredContent.manifest?.publication !==
      "file_commit_each"
  ) {
    throw new Error("best_effort batch did not isolate a failed variant");
  }
  const bestEffortBytes = await readFile(
    join(workspaceRoot, "best-effort-succeeds.png"),
  );
  if (
    !bestEffortBytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("best_effort batch did not publish a valid PNG success");
  const selectionSvg = await workspaceClient.callTool({
    arguments: {
      expectedRevision: settingsRevision,
      flavor: "plain",
      outputPath: "a4-selection.svg",
      path: "a4.svg",
      selectionIds: ["demo_rect"],
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  if (
    selectionSvg.isError ||
    !selectionSvg.structuredContent?.warnings?.includes(
      "SELECTION_EXTRACTED_AUTONOMOUSLY",
    ) ||
    !(await readFile(join(workspaceRoot, "a4-selection.svg"), "utf8")).includes(
      'id="demo_rect"',
    )
  ) {
    throw new Error("export_svg did not publish an autonomous selection SVG");
  }
  await writeFile(
    join(workspaceRoot, "css-selection.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>#card .selected { fill: url(#paint); }</style><defs><linearGradient id="paint"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><g id="card"><rect id="selected" class="selected" width="10" height="10"/></g></svg>',
  );
  const cssInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "css-selection.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const cssRevision = cssInspection.structuredContent?.revision;
  if (cssInspection.isError || typeof cssRevision !== "string")
    throw new Error("document_inspect did not prepare the CSS selection SVG");
  const cssSelection = await workspaceClient.callTool({
    arguments: {
      expectedRevision: cssRevision,
      flavor: "plain",
      outputPath: "css-selection-output.svg",
      path: "css-selection.svg",
      selectionIds: ["selected"],
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  if (
    cssSelection.isError ||
    !cssSelection.structuredContent?.warnings?.includes(
      "SELECTION_STYLESHEET_PRESERVED_PARTIAL",
    ) ||
    !(
      await readFile(join(workspaceRoot, "css-selection-output.svg"), "utf8")
    ).includes("linearGradient") ||
    !(
      await readFile(join(workspaceRoot, "css-selection-output.svg"), "utf8")
    ).includes('id="card"')
  ) {
    throw new Error("export_svg did not preserve selection stylesheet closure");
  }
  await mkdir(join(workspaceRoot, "selection-assets"));
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(workspaceRoot, "selection-assets", "pixel.png"), pixel);
  await writeFile(
    join(workspaceRoot, "image-selection.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image id="selected-image" href="selection-assets/pixel.png" width="1" height="1"/></svg>',
  );
  const imageInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "image-selection.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const imageRevision = imageInspection.structuredContent?.revision;
  if (imageInspection.isError || typeof imageRevision !== "string")
    throw new Error("document_inspect did not prepare the image selection SVG");
  const imageSelection = await workspaceClient.callTool({
    arguments: {
      expectedRevision: imageRevision,
      flavor: "plain",
      outputPath: "image-selection-output.svg",
      path: "image-selection.svg",
      selectionIds: ["selected-image"],
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  const publishedAsset =
    imageSelection.structuredContent?.assets?.[0]?.path ?? "";
  if (
    imageSelection.isError ||
    publishedAsset !== "image-selection-output.svg.assets/0000-pixel.png" ||
    !(
      await readFile(join(workspaceRoot, "image-selection-output.svg"), "utf8")
    ).includes(publishedAsset) ||
    !Buffer.from(await readFile(join(workspaceRoot, publishedAsset))).equals(
      pixel,
    )
  ) {
    throw new Error("export_svg did not publish autonomous selection assets");
  }
  await writeFile(
    join(workspaceRoot, "viewbox-512.svg"),
    await readFile(
      join(process.cwd(), "tests", "fixtures", "svg-viewbox-512.svg"),
    ),
  );
  const viewboxInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "viewbox-512.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const viewboxRevision = viewboxInspection.structuredContent?.revision;
  if (viewboxInspection.isError || typeof viewboxRevision !== "string")
    throw new Error("document_inspect did not prepare the 512 viewBox fixture");
  const viewboxPlain = await workspaceClient.callTool({
    arguments: {
      expectedRevision: viewboxRevision,
      flavor: "plain",
      outputPath: "viewbox-512-plain.svg",
      path: "viewbox-512.svg",
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  if (
    viewboxPlain.isError ||
    viewboxPlain.structuredContent?.viewBox !== "0 0 512 512" ||
    typeof viewboxPlain.structuredContent?.hash !== "string" ||
    (viewboxPlain.structuredContent?.byteLength ?? 0) < 1
  ) {
    throw new Error("export_svg did not preserve the 512 viewBox");
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
