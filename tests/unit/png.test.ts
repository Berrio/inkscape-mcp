import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPng } from "../../src/export/index.js";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
describe("PNG verification", () => {
  it("checks signature and IHDR dimensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-png-"));
    paths.push(root);
    const path = join(root, "result.png");
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12);
    header.writeUInt32BE(320, 16);
    header.writeUInt32BE(200, 20);
    await writeFile(path, header);
    await expect(verifyPng(path, { width: 320, height: 200 })).resolves.toEqual(
      { width: 320, height: 200 },
    );
    await expect(verifyPng(path, { width: 1 })).rejects.toThrow("dimensions");
  });
});
