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
    const header = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12);
    header.writeUInt32BE(320, 16);
    header.writeUInt32BE(200, 20);
    header[24] = 8;
    header[25] = 6;
    await writeFile(path, header);
    const physical = Buffer.alloc(21);
    physical.writeUInt32BE(9, 0);
    physical.write("pHYs", 4);
    physical.writeUInt32BE(11_811, 8);
    physical.writeUInt32BE(11_811, 12);
    physical[16] = 1;
    physical.writeUInt32BE(0, 17);
    await writeFile(path, Buffer.concat([header, physical]));
    const metadata = await verifyPng(path, { width: 320, height: 200 });
    expect(metadata).toMatchObject({ width: 320, height: 200 });
    expect(metadata.dpiX).toBeCloseTo(300);
    expect(metadata.dpiY).toBeCloseTo(300);
    await expect(verifyPng(path, { width: 1 })).rejects.toThrow("dimensions");
  });
});
