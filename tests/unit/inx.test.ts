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
