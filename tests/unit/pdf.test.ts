import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPdf } from "../../src/export/index.js";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
describe("PDF verification", () => {
  it("requires a PDF header and reports the version", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-pdf-"));
    paths.push(root);
    const path = join(root, "export.pdf");
    await writeFile(path, "%PDF-1.5\n");
    await expect(verifyPdf(path)).resolves.toEqual({ version: "1.5" });
    await writeFile(path, "not-pdf");
    await expect(verifyPdf(path)).rejects.toThrow("not a PDF");
  });
});
