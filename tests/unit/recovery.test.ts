import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  recoverStaleScratch,
  ScratchManager,
} from "../../src/storage/index.js";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

it("recovers only old server-owned scratch directories at startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-recovery-"));
  paths.push(root);
  const scratch = new ScratchManager(root);
  const stale = await scratch.create("staging");
  const live = await scratch.create("job");
  await utimes(stale, new Date(0), new Date(0));

  await expect(recoverStaleScratch(root, 60_000)).resolves.toBe(1);
  expect(await readdir(root)).toContain(live.split(/[\\/]/u).at(-1)!);
  await expect(readdir(stale)).rejects.toBeDefined();
});
