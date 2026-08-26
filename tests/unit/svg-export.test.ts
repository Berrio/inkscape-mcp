import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifySvg } from "../../src/export/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("SVG export verification", () => {
  it("reports a safe SVG hash, size and validated viewBox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-svg-"));
    directories.push(directory);
    const path = join(directory, "export.svg");
    await writeFile(
      path,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>',
    );
    await expect(verifySvg(path)).resolves.toMatchObject({
      byteLength: expect.any(Number),
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      idCount: 0,
      referenceCount: 0,
      viewBox: "0 0 512 512",
    });
  });
  it("rejects exported SVG that would require safety removal or lacks viewBox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-svg-"));
    directories.push(directory);
    const path = join(directory, "export.svg");
    await writeFile(path, '<svg viewBox="0 0 1 1"><script/></svg>');
    await expect(verifySvg(path)).rejects.toThrow("safety policy");
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(verifySvg(path)).rejects.toThrow("invalid viewBox");
  });
  it("rejects invalid namespaces, IDs, and unresolved local references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-svg-"));
    directories.push(directory);
    const path = join(directory, "export.svg");
    await writeFile(path, '<svg viewBox="0 0 1 1"/>');
    await expect(verifySvg(path)).rejects.toThrow("invalid namespace");
    await writeFile(
      path,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect id="dup"/><circle id="dup"/></svg>',
    );
    await expect(verifySvg(path)).rejects.toThrow("duplicate ID");
    await writeFile(
      path,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="url(#missing)"/></svg>',
    );
    await expect(verifySvg(path)).rejects.toThrow(
      "unresolved internal reference",
    );
  });
});
