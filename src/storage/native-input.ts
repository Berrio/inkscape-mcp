import { copyFile } from "node:fs/promises";
import { join } from "node:path";

import { assertRevision, sha256File } from "./revisions.js";

export type NativeInputBundle = {
  path: string;
  revision: string;
};

/** Creates a stable input so native processes never receive the live workspace file. */
export async function createNativeInputBundle(
  sourcePath: string,
  expectedRevision: string,
  directory: string,
): Promise<NativeInputBundle> {
  await assertRevision(sourcePath, expectedRevision);
  const path = join(directory, "input.svg");
  await copyFile(sourcePath, path);
  const revision = await sha256File(path);
  if (revision !== expectedRevision) {
    throw new Error("Could not create a consistent native input bundle");
  }
  await assertRevision(sourcePath, expectedRevision);
  return { path, revision };
}
