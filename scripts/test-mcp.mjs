import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { comparePngVisual, decodePngRgba } from "../dist/export/index.js";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
    join(workspaceRoot, "paths.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><path id="path_left" fill="#ff0000" d="M 0 0 L 2 0"/><path id="path_right" fill="#ff0000" d="M 4 0 L 6 0"/></svg>',
  );
  const pathsRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "paths.svg")))
    .digest("hex");
  const combinedPaths = await workspaceClient.callTool({
    arguments: {
      expectedRevision: pathsRevision,
      ids: ["path_left", "path_right"],
      path: "paths.svg",
      workspaceId: workspace.id,
    },
    name: "paths_combine",
  });
  const combinedPathsRevision = combinedPaths.structuredContent?.revision;
  if (
    combinedPaths.isError ||
    combinedPaths.structuredContent?.id !== "path_left" ||
    combinedPaths.structuredContent?.removedIds?.[0] !== "path_right" ||
    typeof combinedPathsRevision !== "string"
  )
    throw new Error("paths_combine did not preserve its target path");
  const brokenPaths = await workspaceClient.callTool({
    arguments: {
      expectedRevision: combinedPathsRevision,
      id: "path_left",
      newIds: ["path_first", "path_second"],
      path: "paths.svg",
      workspaceId: workspace.id,
    },
    name: "path_break_apart",
  });
  const brokenPathsRevision = brokenPaths.structuredContent?.revision;
  if (
    brokenPaths.isError ||
    brokenPaths.structuredContent?.ids?.length !== 2 ||
    typeof brokenPathsRevision !== "string"
  )
    throw new Error("path_break_apart did not publish explicit new IDs");
  const reversedPath = await workspaceClient.callTool({
    arguments: {
      expectedRevision: brokenPathsRevision,
      id: "path_first",
      path: "paths.svg",
      workspaceId: workspace.id,
    },
    name: "path_reverse",
  });
  const reversedPathRevision = reversedPath.structuredContent?.revision;
  if (
    reversedPath.isError ||
    reversedPath.structuredContent?.id !== "path_first" ||
    typeof reversedPathRevision !== "string"
  )
    throw new Error("path_reverse did not preserve the path identity");
  const booleanPaths = await workspaceClient.callTool({
    arguments: {
      expectedRevision: reversedPathRevision,
      ids: ["path_first", "path_second"],
      operation: "union",
      path: "paths.svg",
      workspaceId: workspace.id,
    },
    name: "paths_boolean",
  });
  if (
    booleanPaths.isError ||
    booleanPaths.structuredContent?.operation !== "union" ||
    (booleanPaths.structuredContent?.diff?.removedIds?.length ?? 0) < 1
  )
    throw new Error("paths_boolean did not run Inkscape path union");
  await writeFile(
    join(workspaceRoot, "gradients.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="gradient_target" width="10" height="5"/></svg>',
  );
  const gradientsRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "gradients.svg")))
    .digest("hex");
  const gradientCreated = await workspaceClient.callTool({
    arguments: {
      action: "create",
      expectedRevision: gradientsRevision,
      path: "gradients.svg",
      spec: {
        id: "sunset",
        kind: "linear",
        stops: [
          { color: "#ff0000", offset: 0 },
          { color: "#0000ff", offset: 1 },
        ],
      },
      workspaceId: workspace.id,
    },
    name: "gradients_manage",
  });
  const gradientCreatedRevision = gradientCreated.structuredContent?.revision;
  if (gradientCreated.isError || typeof gradientCreatedRevision !== "string")
    throw new Error("gradients_manage did not create a gradient");
  const gradientApplied = await workspaceClient.callTool({
    arguments: {
      action: "apply",
      expectedRevision: gradientCreatedRevision,
      id: "sunset",
      paint: "fill",
      path: "gradients.svg",
      targetIds: ["gradient_target"],
      workspaceId: workspace.id,
    },
    name: "gradients_manage",
  });
  const gradientAppliedRevision = gradientApplied.structuredContent?.revision;
  if (gradientApplied.isError || typeof gradientAppliedRevision !== "string")
    throw new Error("gradients_manage did not apply a gradient");
  const gradientUpdated = await workspaceClient.callTool({
    arguments: {
      action: "update",
      expectedRevision: gradientAppliedRevision,
      path: "gradients.svg",
      spec: {
        id: "sunset",
        kind: "radial",
        r: 1,
        stops: [
          { color: "#00ff00", offset: 0 },
          { color: "#0000ff", offset: 1, opacity: 0.5 },
        ],
      },
      workspaceId: workspace.id,
    },
    name: "gradients_manage",
  });
  if (
    gradientUpdated.isError ||
    gradientUpdated.structuredContent?.id !== "sunset"
  )
    throw new Error("gradients_manage did not update a gradient");
  await writeFile(
    join(workspaceRoot, "metadata.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><image id="accessible_image" href="data:image/png;base64,AA==" width="1" height="1"/></svg>',
  );
  const metadataRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "metadata.svg")))
    .digest("hex");
  const documentMetadata = await workspaceClient.callTool({
    arguments: {
      action: "document",
      description: "Accessible preview",
      expectedRevision: metadataRevision,
      license: "MIT",
      path: "metadata.svg",
      title: "Preview",
      workspaceId: workspace.id,
    },
    name: "metadata_manage",
  });
  const documentMetadataRevision = documentMetadata.structuredContent?.revision;
  if (documentMetadata.isError || typeof documentMetadataRevision !== "string")
    throw new Error("metadata_manage did not update document metadata");
  const elementMetadata = await workspaceClient.callTool({
    arguments: {
      action: "elements",
      elements: [
        {
          description: "One pixel image",
          id: "accessible_image",
          label: "Preview image",
          title: "Preview",
        },
      ],
      expectedRevision: documentMetadataRevision,
      path: "metadata.svg",
      workspaceId: workspace.id,
    },
    name: "metadata_manage",
  });
  if (
    elementMetadata.isError ||
    elementMetadata.structuredContent?.ids?.[0] !== "accessible_image"
  )
    throw new Error("metadata_manage did not update element accessibility");
  await writeFile(
    join(workspaceRoot, "text-path.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><path id="baseline" d="M 0 0 L 10 0"/><text id="curved_text" x="0" y="0">Hello<tspan dx="1">!</tspan></text></svg>',
  );
  const textPathRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "text-path.svg")))
    .digest("hex");
  const attachedTextPath = await workspaceClient.callTool({
    arguments: {
      action: "attach",
      expectedRevision: textPathRevision,
      path: "text-path.svg",
      pathId: "baseline",
      startOffset: 1,
      textId: "curved_text",
      workspaceId: workspace.id,
    },
    name: "text_path_manage",
  });
  const attachedTextPathRevision = attachedTextPath.structuredContent?.revision;
  if (attachedTextPath.isError || typeof attachedTextPathRevision !== "string")
    throw new Error("text_path_manage did not attach text to a path");
  const detachedTextPath = await workspaceClient.callTool({
    arguments: {
      action: "detach",
      expectedRevision: attachedTextPathRevision,
      path: "text-path.svg",
      textId: "curved_text",
      workspaceId: workspace.id,
    },
    name: "text_path_manage",
  });
  if (
    detachedTextPath.isError ||
    detachedTextPath.structuredContent?.textId !== "curved_text"
  )
    throw new Error("text_path_manage did not detach text from a path");
  await writeFile(
    join(workspaceRoot, "image-crop.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" href="data:image/png;base64,AA==" width="10" height="8"/></svg>',
  );
  const imageCropRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "image-crop.svg")))
    .digest("hex");
  const croppedImage = await workspaceClient.callTool({
    arguments: {
      clipId: "photo_crop",
      expectedRevision: imageCropRevision,
      height: 4,
      imageId: "photo",
      path: "image-crop.svg",
      width: 5,
      workspaceId: workspace.id,
      x: 1,
      y: 2,
    },
    name: "images_crop",
  });
  if (
    croppedImage.isError ||
    croppedImage.structuredContent?.clipId !== "photo_crop" ||
    croppedImage.structuredContent?.imageId !== "photo"
  )
    throw new Error("images_crop did not add a non-destructive crop");
  await writeFile(
    join(workspaceRoot, "clips.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="clipped_target" width="10" height="8"/></svg>',
  );
  const clipsRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "clips.svg")))
    .digest("hex");
  const createdClip = await workspaceClient.callTool({
    arguments: {
      action: "create",
      expectedRevision: clipsRevision,
      path: "clips.svg",
      spec: { height: 4, id: "window_clip", width: 5, x: 1, y: 2 },
      workspaceId: workspace.id,
    },
    name: "clips_manage",
  });
  const createdClipRevision = createdClip.structuredContent?.revision;
  if (createdClip.isError || typeof createdClipRevision !== "string")
    throw new Error("clips_manage did not create a clipPath");
  const appliedClip = await workspaceClient.callTool({
    arguments: {
      action: "apply",
      expectedRevision: createdClipRevision,
      id: "window_clip",
      path: "clips.svg",
      targetIds: ["clipped_target"],
      workspaceId: workspace.id,
    },
    name: "clips_manage",
  });
  const appliedClipRevision = appliedClip.structuredContent?.revision;
  if (appliedClip.isError || typeof appliedClipRevision !== "string")
    throw new Error("clips_manage did not apply a clipPath");
  const releasedClip = await workspaceClient.callTool({
    arguments: {
      action: "release",
      expectedRevision: appliedClipRevision,
      path: "clips.svg",
      targetIds: ["clipped_target"],
      workspaceId: workspace.id,
    },
    name: "clips_manage",
  });
  if (
    releasedClip.isError ||
    releasedClip.structuredContent?.action !== "release"
  )
    throw new Error("clips_manage did not release a clipPath");
  await writeFile(
    join(workspaceRoot, "masks.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="masked_target" width="10" height="8"/></svg>',
  );
  const masksRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "masks.svg")))
    .digest("hex");
  const createdMask = await workspaceClient.callTool({
    arguments: {
      action: "create",
      expectedRevision: masksRevision,
      path: "masks.svg",
      spec: { height: 4, id: "window_mask", width: 5, x: 1, y: 2 },
      workspaceId: workspace.id,
    },
    name: "masks_manage",
  });
  const createdMaskRevision = createdMask.structuredContent?.revision;
  if (createdMask.isError || typeof createdMaskRevision !== "string")
    throw new Error("masks_manage did not create a mask");
  const appliedMask = await workspaceClient.callTool({
    arguments: {
      action: "apply",
      expectedRevision: createdMaskRevision,
      id: "window_mask",
      path: "masks.svg",
      targetIds: ["masked_target"],
      workspaceId: workspace.id,
    },
    name: "masks_manage",
  });
  const appliedMaskRevision = appliedMask.structuredContent?.revision;
  if (appliedMask.isError || typeof appliedMaskRevision !== "string")
    throw new Error("masks_manage did not apply a mask");
  const releasedMask = await workspaceClient.callTool({
    arguments: {
      action: "release",
      expectedRevision: appliedMaskRevision,
      path: "masks.svg",
      targetIds: ["masked_target"],
      workspaceId: workspace.id,
    },
    name: "masks_manage",
  });
  if (
    releasedMask.isError ||
    releasedMask.structuredContent?.action !== "release"
  )
    throw new Error("masks_manage did not release a mask");
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
    join(workspaceRoot, "unsafe-import.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("x")</script><rect id="safe" onclick="alert(1)" width="5" height="5"/></svg>',
  );
  const unsafeRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "unsafe-import.svg")))
    .digest("hex");
  const importedSvg = await workspaceClient.callTool({
    arguments: {
      expectedRevision: unsafeRevision,
      outputPath: "safe-import.svg",
      path: "unsafe-import.svg",
      sanitizeMode: "preserve-local",
      workspaceId: workspace.id,
    },
    name: "document_import_svg",
  });
  if (importedSvg.isError)
    throw new Error("document_import_svg did not sanitize an imported SVG");
  const importedText = await readFile(
    join(workspaceRoot, "safe-import.svg"),
    "utf8",
  );
  if (
    !importedSvg.structuredContent?.removed?.includes("element:script") ||
    !importedText.includes('id="safe"') ||
    /<script|onclick=/iu.test(importedText)
  )
    throw new Error("document_import_svg published unsafe SVG content");
  await writeFile(
    join(workspaceRoot, "normalize-ids.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="legacy:gradient"/></defs><style>#legacy\\:gradient { fill: url(#legacy:gradient); }</style><rect id="duplicate" fill="url(#legacy:gradient)"/><use href="#legacy:gradient"/><circle id="duplicate"/><path/></svg>',
  );
  const normalizationRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "normalize-ids.svg")))
    .digest("hex");
  const normalizedIds = await workspaceClient.callTool({
    arguments: {
      assignMissingIds: true,
      expectedRevision: normalizationRevision,
      path: "normalize-ids.svg",
      prefix: "normalized",
      workspaceId: workspace.id,
    },
    name: "document_normalize_ids",
  });
  const normalizedLegacyId = normalizedIds.structuredContent?.renamed?.find(
    (rename) => rename.from === "legacy:gradient",
  )?.to;
  const normalizedText = await readFile(
    join(workspaceRoot, "normalize-ids.svg"),
    "utf8",
  );
  if (
    normalizedIds.isError ||
    typeof normalizedLegacyId !== "string" ||
    normalizedText.includes("legacy:gradient") ||
    !normalizedText.includes(`url(#${normalizedLegacyId})`) ||
    !normalizedText.includes(`href="#${normalizedLegacyId}"`) ||
    !normalizedIds.structuredContent?.renamed?.some(
      (rename) => rename.reason === "duplicate",
    ) ||
    !normalizedIds.structuredContent?.renamed?.some(
      (rename) => rename.reason === "missing",
    )
  )
    throw new Error("document_normalize_ids did not rewrite safe references");
  await writeFile(
    join(workspaceRoot, "delete-reference.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="protected_filter"/></defs><rect filter="url(#protected_filter)"/></svg>',
  );
  const deleteReferenceRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "delete-reference.svg")))
    .digest("hex");
  const protectedDelete = await workspaceClient.callTool({
    arguments: {
      expectedRevision: deleteReferenceRevision,
      ids: ["protected_filter"],
      path: "delete-reference.svg",
      workspaceId: workspace.id,
    },
    name: "elements_delete",
  });
  if (!protectedDelete.isError)
    throw new Error("elements_delete broke a URL fragment reference");
  await writeFile(
    join(workspaceRoot, "id-delimiters.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><rect id="with,comma" x="0" y="0" width="10" height="10"/><rect id="with;semicolon" x="20" y="0" width="10" height="10"/><rect id="with space" x="40" y="0" width="10" height="10"/><rect id="mañana" x="60" y="0" width="10" height="10"/><rect id="public_rect" x="80" y="0" width="10" height="10"/></svg>',
  );
  const delimiterRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "id-delimiters.svg")))
    .digest("hex");
  const delimiterBounds = await workspaceClient.callTool({
    arguments: {
      expectedRevision: delimiterRevision,
      includeBounds: true,
      path: "id-delimiters.svg",
      workspaceId: workspace.id,
    },
    name: "elements_query",
  });
  if (
    delimiterBounds.isError ||
    delimiterBounds.structuredContent?.elements?.filter(
      (element) => typeof element.bounds?.width === "number",
    ).length !== 5 ||
    !delimiterBounds.structuredContent?.elements?.some(
      (element) => element.id === "public_rect" && element.bounds !== undefined,
    )
  )
    throw new Error("elements_query did not remap delimiter IDs safely");
  const packageTexture = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(workspaceRoot, "package-texture.png"), packageTexture);
  await writeFile(
    join(workspaceRoot, "package-source.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image id="texture" href="package-texture.png" width="1" height="1"/></svg>',
  );
  const packageRevision = createHash("sha256")
    .update(await readFile(join(workspaceRoot, "package-source.svg")))
    .digest("hex");
  const unlicensedPackage = await workspaceClient.callTool({
    arguments: {
      expectedRevision: packageRevision,
      outputDirectory: "unlicensed-package",
      path: "package-source.svg",
      workspaceId: workspace.id,
    },
    name: "assets_package",
  });
  if (!unlicensedPackage.isError)
    throw new Error("assets_package accepted an unlicensed dependency");
  const packagedAssets = await workspaceClient.callTool({
    arguments: {
      assetLicenses: [
        { license: "test fixture only", sourceUri: "package-texture.png" },
      ],
      expectedRevision: packageRevision,
      outputDirectory: "portable-package",
      path: "package-source.svg",
      workspaceId: workspace.id,
    },
    name: "assets_package",
  });
  if (
    packagedAssets.isError ||
    packagedAssets.structuredContent?.dependencyCount !== 1 ||
    packagedAssets.structuredContent?.documentPath !==
      "portable-package/document.svg" ||
    !packagedAssets.structuredContent?.files?.some(
      (file) => file.path === "assets/0000-package-texture.png",
    )
  )
    throw new Error("assets_package did not return the portable package");
  const packagedDocument = await readFile(
    join(workspaceRoot, "portable-package", "document.svg"),
    "utf8",
  );
  const packagedManifest = JSON.parse(
    await readFile(
      join(workspaceRoot, "portable-package", "manifest.json"),
      "utf8",
    ),
  );
  if (
    !packagedDocument.includes("assets/0000-package-texture.png") ||
    !(
      await readFile(
        join(
          workspaceRoot,
          "portable-package",
          "assets",
          "0000-package-texture.png",
        ),
      )
    ).equals(packageTexture) ||
    packagedManifest.schema !== "inkscape-mcp-assets-package/v1" ||
    packagedManifest.source.path !== "package-source.svg" ||
    packagedManifest.dependencies?.[0]?.license !== "test fixture only"
  )
    throw new Error(
      "assets_package did not publish a portable dependency tree",
    );
  const packagedDocumentRevision = packagedAssets.structuredContent.files.find(
    (file) => file.path === "document.svg",
  )?.revision;
  const reopenedPackage = await workspaceClient.callTool({
    arguments: {
      expectedRevision: packagedDocumentRevision,
      outputPath: "portable-package-preview.png",
      path: "portable-package/document.svg",
      width: 16,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (reopenedPackage.isError)
    throw new Error("assets_package did not reopen through Inkscape");
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
        {
          cx: 110,
          cy: 120,
          id: "demo_spiral",
          kind: "spiral",
          parentId: "layer_main",
          r: 12,
          turns: 2,
        },
        {
          assetPath: "package-texture.png",
          embedding: "link",
          height: 12,
          id: "linked_image",
          kind: "image",
          width: 12,
          x: 5,
          y: 110,
        },
        {
          assetPath: "package-texture.png",
          embedding: "embed",
          height: 8,
          id: "embedded_image",
          kind: "image",
          width: 8,
          x: 20,
          y: 110,
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
    elements.structuredContent?.ids?.[6] !== "demo_spiral" ||
    elements.structuredContent?.ids?.[7] !== "linked_image" ||
    elements.structuredContent?.ids?.[8] !== "embedded_image" ||
    typeof elementsRevision !== "string"
  ) {
    throw new Error("elements_create did not publish a typed rectangle");
  }
  const createdElementsText = await readFile(
    join(workspaceRoot, "a4.svg"),
    "utf8",
  );
  if (
    !createdElementsText.includes('href="package-texture.png"') ||
    !createdElementsText.includes('href="data:image/png;base64,')
  )
    throw new Error(
      "elements_create did not publish linked and embedded images",
    );
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
  const flattened = await workspaceClient.callTool({
    arguments: {
      expectedRevision: transformedRevision,
      ids: ["demo_rect"],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_flatten_transform",
  });
  const flattenedRevision = flattened.structuredContent?.revision;
  if (
    flattened.isError ||
    flattened.structuredContent?.flattenedIds?.[0] !== "demo_rect" ||
    typeof flattenedRevision !== "string"
  ) {
    throw new Error("elements_flatten_transform did not bake a safe transform");
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
      expectedRevision: flattenedRevision,
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
          style: {
            classes: ["mcp-verified"],
            fill: "#00ff00",
            fillOpacity: 0.75,
            paintOrder: "stroke fill markers",
            stroke: "none",
            strokeDasharray: [1, 2],
          },
        },
        { id: "demo_text", text: "Updated from MCP" },
      ],
      expectedRevision: flattenedRevision,
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
  const transactionPreview = await workspaceClient.callTool({
    arguments: {
      dryRun: true,
      expectedRevision: updatedRevision,
      operations: [
        {
          aliases: { transaction_preview: "tx_preview" },
          elements: [
            { height: 4, id: "tx_preview", kind: "rect", width: 4, x: 1, y: 1 },
          ],
          kind: "create",
        },
        {
          ids: ["@transaction_preview"],
          kind: "transform",
          transform: { kind: "translate", x: 2, y: 3 },
        },
      ],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_apply_operations",
  });
  if (
    transactionPreview.isError ||
    transactionPreview.structuredContent?.dryRun !== true ||
    transactionPreview.structuredContent?.estimatedCost !== 2 ||
    !transactionPreview.structuredContent?.diff?.addedIds?.includes(
      "tx_preview",
    ) ||
    transactionPreview.structuredContent?.revision !== updatedRevision
  ) {
    throw new Error(
      "document_apply_operations dry run did not return a semantic plan",
    );
  }
  const transaction = await workspaceClient.callTool({
    arguments: {
      expectedRevision: updatedRevision,
      operations: [
        {
          aliases: {
            transaction_rect: "tx_rect",
            transaction_second: "tx_second",
          },
          elements: [
            { height: 4, id: "tx_rect", kind: "rect", width: 4, x: 1, y: 1 },
            {
              height: 4,
              id: "tx_second",
              kind: "rect",
              width: 4,
              x: 8,
              y: 1,
            },
          ],
          kind: "create",
        },
        {
          kind: "arrange",
          request: {
            action: "before",
            ids: ["@transaction_second"],
            relativeTo: "@transaction_rect",
          },
        },
        {
          alias: "transaction_clone",
          id: "@transaction_rect",
          kind: "duplicate",
          mode: "copy",
          newId: "tx_clone",
        },
        {
          elements: [{ id: "@transaction_clone", style: { fill: "#123456" } }],
          kind: "update",
        },
        {
          kind: "group",
          request: {
            action: "group",
            alias: "transaction_group",
            groupId: "tx_group",
            ids: ["@transaction_rect", "@transaction_clone"],
          },
        },
        {
          ids: ["@transaction_second"],
          kind: "reparent",
          parentId: "@transaction_group",
        },
        {
          ids: ["@transaction_group"],
          kind: "transform",
          transform: { kind: "translate", x: 2, y: 3 },
        },
        {
          aliases: { transaction_discard: "tx_discard" },
          elements: [
            {
              height: 1,
              id: "tx_discard",
              kind: "rect",
              width: 1,
              x: 1,
              y: 8,
            },
          ],
          kind: "create",
        },
        { ids: ["@transaction_discard"], kind: "delete" },
      ],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_apply_operations",
  });
  const transactionRevision = transaction.structuredContent?.revision;
  if (
    transaction.isError ||
    transaction.structuredContent?.dryRun !== false ||
    transaction.structuredContent?.estimatedCost !== 11 ||
    !transaction.structuredContent?.diff?.addedIds?.includes("tx_rect") ||
    typeof transactionRevision !== "string"
  ) {
    throw new Error(
      "document_apply_operations did not atomically commit a design transaction",
    );
  }
  const failedTransaction = await workspaceClient.callTool({
    arguments: {
      expectedRevision: transactionRevision,
      operations: [
        {
          elements: [
            {
              height: 4,
              id: "tx_rollback",
              kind: "rect",
              width: 4,
              x: 1,
              y: 1,
            },
          ],
          kind: "create",
        },
        { ids: ["missing_shape"], kind: "delete" },
      ],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "document_apply_operations",
  });
  if (!failedTransaction.isError) {
    throw new Error(
      "document_apply_operations published a partial failed transaction",
    );
  }
  const arranged = await workspaceClient.callTool({
    arguments: {
      action: "front",
      expectedRevision: transactionRevision,
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
  const arrangedByIndex = await workspaceClient.callTool({
    arguments: {
      action: "index",
      expectedRevision: arrangedRevision,
      ids: ["demo_text"],
      index: 0,
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_arrange",
  });
  const indexedRevision = arrangedByIndex.structuredContent?.revision;
  if (
    arrangedByIndex.isError ||
    arrangedByIndex.structuredContent?.index !== 0 ||
    typeof indexedRevision !== "string"
  ) {
    throw new Error("elements_arrange did not support deterministic indexes");
  }
  const grouped = await workspaceClient.callTool({
    arguments: {
      action: "group",
      expectedRevision: indexedRevision,
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
  const copied = await workspaceClient.callTool({
    arguments: {
      expectedRevision: groupedRevision,
      id: "demo_rect",
      mode: "copy",
      newId: "demo_rect_copy",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_duplicate",
  });
  const copiedRevision = copied.structuredContent?.revision;
  if (
    copied.isError ||
    copied.structuredContent?.id !== "demo_rect_copy" ||
    typeof copiedRevision !== "string"
  )
    throw new Error("elements_duplicate did not create an independent copy");
  const cloned = await workspaceClient.callTool({
    arguments: {
      expectedRevision: copiedRevision,
      id: "demo_rect",
      mode: "use",
      newId: "demo_rect_use",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_duplicate",
  });
  const duplicatedRevision = cloned.structuredContent?.revision;
  if (
    cloned.isError ||
    cloned.structuredContent?.id !== "demo_rect_use" ||
    typeof duplicatedRevision !== "string"
  )
    throw new Error("elements_duplicate did not create a use clone");
  const reparented = await workspaceClient.callTool({
    arguments: {
      expectedRevision: duplicatedRevision,
      ids: ["demo_star"],
      parentId: "demo_group",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_reparent",
  });
  const reparentedRevision = reparented.structuredContent?.revision;
  if (
    reparented.isError ||
    reparented.structuredContent?.ids?.[0] !== "demo_star" ||
    typeof reparentedRevision !== "string"
  )
    throw new Error("elements_reparent did not move an element into a group");
  const aligned = await workspaceClient.callTool({
    arguments: {
      alignment: "center",
      anchor: { kind: "page", pageId: "page_front" },
      expectedRevision: reparentedRevision,
      ids: ["demo_rect", "demo_text"],
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_align",
  });
  const alignedRevision = aligned.structuredContent?.revision;
  if (
    aligned.isError ||
    aligned.structuredContent?.moves?.length !== 2 ||
    typeof alignedRevision !== "string"
  )
    throw new Error("elements_align did not use native page visual bounds");
  const distributed = await workspaceClient.callTool({
    arguments: {
      axis: "horizontal",
      expectedRevision: alignedRevision,
      ids: ["demo_rect", "demo_text", "demo_star"],
      mode: "centers",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "elements_distribute",
  });
  const distributedRevision = distributed.structuredContent?.revision;
  if (
    distributed.isError ||
    distributed.structuredContent?.moves?.length !== 3 ||
    typeof distributedRevision !== "string"
  )
    throw new Error("elements_distribute did not use native visual bounds");
  const inspected = await workspaceClient.callTool({
    arguments: {
      expectedRevision: distributedRevision,
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
      expectedRevision: distributedRevision,
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
  const timedOutBatch = await workspaceClient.callTool({
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
            path: "must-not-publish-after-timeout.png",
          },
        },
      ],
      timeoutMs: 1,
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  const timeoutOutputExists = await readFile(
    join(workspaceRoot, "must-not-publish-after-timeout.png"),
  )
    .then(() => true)
    .catch(() => false);
  if (!timedOutBatch.isError || timeoutOutputExists)
    throw new Error("batch timeout published a partial output");
  const submittedJob = await workspaceClient.callTool({
    arguments: {
      delivery: "job",
      mode: "all_or_nothing",
      specs: [
        {
          area: { kind: "page" },
          background: { mode: "transparent" },
          format: "png",
          size: { dpi: 300, mode: "dpi" },
          source: { expectedRevision: settingsRevision, path: "a4.svg" },
          target: {
            kind: "file",
            overwrite: false,
            path: "must-not-publish-after-cancel.png",
          },
        },
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  const jobId = submittedJob.structuredContent?.jobId;
  if (submittedJob.isError || typeof jobId !== "string")
    throw new Error("document_export_batch did not submit an async job");
  const cancelledJob = await workspaceClient.callTool({
    arguments: { jobId, workspaceId: workspace.id },
    name: "job_cancel",
  });
  if (cancelledJob.isError) throw new Error("job_cancel rejected an owned job");
  let completedCancellation;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await workspaceClient.callTool({
      arguments: { jobId, workspaceId: workspace.id },
      name: "job_get",
    });
    if (status.isError) throw new Error("job_get rejected an owned job");
    if (status.structuredContent?.status === "cancelled") {
      completedCancellation = status.structuredContent;
      break;
    }
    await delay(25);
  }
  const cancelOutputExists = await readFile(
    join(workspaceRoot, "must-not-publish-after-cancel.png"),
  )
    .then(() => true)
    .catch(() => false);
  if (completedCancellation === undefined || cancelOutputExists)
    throw new Error("cancelled export job published a partial output");
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
  const sourceSelectionPng = await workspaceClient.callTool({
    arguments: {
      expectedRevision: cssRevision,
      outputPath: "css-selection-source.png",
      path: "css-selection.svg",
      width: 80,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  const derivedInspection = await workspaceClient.callTool({
    arguments: {
      level: "summary",
      path: "css-selection-output.svg",
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  const derivedRevision = derivedInspection.structuredContent?.revision;
  const derivedSelectionPng = await workspaceClient.callTool({
    arguments: {
      expectedRevision: derivedRevision,
      outputPath: "css-selection-derived.png",
      path: "css-selection-output.svg",
      width: 80,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    sourceSelectionPng.isError ||
    derivedSelectionPng.isError ||
    typeof derivedRevision !== "string"
  ) {
    throw new Error("could not rasterize both sides of the SVG selection");
  }
  const cssVisualDiff = comparePngVisual(
    decodePngRgba(
      await readFile(join(workspaceRoot, "css-selection-source.png")),
    ),
    decodePngRgba(
      await readFile(join(workspaceRoot, "css-selection-derived.png")),
    ),
    1,
  );
  if (cssVisualDiff.differingPixels !== 0)
    throw new Error("autonomous SVG selection changed visual pixels");
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
