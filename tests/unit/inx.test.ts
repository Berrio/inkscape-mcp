import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { discoverInxExporters } from "../../src/extensions/inx.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  ),
);

it("discovers only bounded output manifests and rejects XML entity declarations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-inx-"));
  directories.push(directory);
  await writeFile(
    join(directory, "dxf.inx"),
    "<inkscape-extension><name>DXF</name><id>org.example.dxf</id><output><extension>.dxf</extension></output></inkscape-extension>",
  );
  await writeFile(
    join(directory, "unsafe.inx"),
    "<!DOCTYPE a><inkscape-extension/>",
  );
  expect(await discoverInxExporters([directory])).toEqual([
    { id: "org.example.dxf", name: "DXF", outputExtension: "dxf" },
  ]);
});

it("skips malformed, oversized, and invalid-ID manifests without failing discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-inx-"));
  directories.push(directory);
  await writeFile(
    join(directory, "valid.inx"),
    "<inkscape-extension><name>Valid</name><id>org.example_valid</id><output><extension>.valid</extension></output></inkscape-extension>",
  );
  await writeFile(
    join(directory, "malformed.inx"),
    "<inkscape-extension><name>Malformed</name><id>org.example.bad</id>",
  );
  await writeFile(
    join(directory, "invalid-id.inx"),
    "<inkscape-extension><name>Invalid</name><id>bad id</id><output><extension>.bad</extension></output></inkscape-extension>",
  );
  await writeFile(
    join(directory, "oversized.inx"),
    Buffer.alloc(512 * 1024 + 1, 0x20),
  );

  await expect(discoverInxExporters([directory])).resolves.toEqual([
    { id: "org.example_valid", name: "Valid", outputExtension: "valid" },
  ]);
});
