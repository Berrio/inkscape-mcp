import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sanitizeSvg, type SanitizeMode } from "../svg/index.js";
import { assertRevision, sha256File } from "./revisions.js";

export type NativeInputBundle = {
  path: string;
  revision: string;
};
export type NativeInputBundleOptions = {
  maximumSanitizeMode?: SanitizeMode | undefined;
};

/** Creates a stable input so native processes never receive the live workspace file. */
export async function createNativeInputBundle(
  sourcePath: string,
  expectedRevision: string,
  directory: string,
  options: NativeInputBundleOptions = {},
): Promise<NativeInputBundle> {
  await assertRevision(sourcePath, expectedRevision);
  const source = await readFile(sourcePath, "utf8");
  const sanitization = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    maximumMode: options.maximumSanitizeMode ?? "preserve-local",
    mode:
      options.maximumSanitizeMode === "strict" ? "strict" : "preserve-local",
  });
  if (sanitization.removed.length > 0) {
    throw new Error("Native export input violates the SVG safety policy");
  }
  const path = join(directory, "input.svg");
  await copyFile(sourcePath, path);
  const revision = await sha256File(path);
  if (revision !== expectedRevision) {
    throw new Error("Could not create a consistent native input bundle");
  }
  await assertRevision(sourcePath, expectedRevision);
  return { path, revision };
}
