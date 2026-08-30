import { Buffer } from "node:buffer";

import { type AtomicFileStore } from "../storage/index.js";

/**
 * Publishes a converted SVG and its reproducible manifest as one logical
 * import result. Adapters may differ in how they obtain the SVG, but none may
 * publish a document without its sidecar manifest.
 */
export async function publishImportedSvg<TManifest extends object>(request: {
  contents: Buffer;
  expectedRevision: string;
  fileStore: AtomicFileStore;
  manifest: TManifest;
  manifestTargetPath: string;
  outputTargetPath: string;
  sourcePath: string;
}): Promise<{
  manifest: TManifest;
  manifestRevision: string;
  revision: string;
}> {
  if (
    request.outputTargetPath.toLocaleLowerCase() ===
    request.manifestTargetPath.toLocaleLowerCase()
  )
    throw new Error("Import output and manifest paths must differ");
  const committed = await request.fileStore.commitBatch({
    expectedRevision: request.expectedRevision,
    files: [
      { contents: request.contents, targetPath: request.outputTargetPath },
      {
        contents: Buffer.from(`${JSON.stringify(request.manifest, null, 2)}\n`),
        targetPath: request.manifestTargetPath,
      },
    ],
    sourcePath: request.sourcePath,
  });
  const revisions = new Map(
    committed.files.map((file) => [file.targetPath, file.revision]),
  );
  const revision = revisions.get(request.outputTargetPath);
  const manifestRevision = revisions.get(request.manifestTargetPath);
  if (!revision || !manifestRevision)
    throw new Error("Import pipeline did not publish its complete manifest");
  return { manifest: request.manifest, manifestRevision, revision };
}
