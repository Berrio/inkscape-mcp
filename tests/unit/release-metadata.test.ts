import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type PackageMetadata = {
  mcpName: string;
  name: string;
  private: boolean;
  version: string;
};

type Lockfile = {
  packages: Record<string, { version?: string }>;
  version: string;
};

type ServerManifest = {
  name: string;
  packages: Array<{
    identifier: string;
    registryType: string;
    transport: { type: string };
    version: string;
  }>;
  version: string;
};

const root = process.cwd();
const readJson = <T>(fileName: string): T =>
  JSON.parse(readFileSync(resolve(root, fileName), "utf8")) as T;

describe("release metadata", () => {
  it("keeps the local package, lockfile, server manifest, and changelog aligned", () => {
    const packageMetadata = readJson<PackageMetadata>("package.json");
    const lockfile = readJson<Lockfile>("package-lock.json");
    const serverManifest = readJson<ServerManifest>("server.json");
    const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");

    expect(packageMetadata.version).toMatch(/^0\.1\.0$/u);
    expect(lockfile.version).toBe(packageMetadata.version);
    expect(lockfile.packages[""]?.version).toBe(packageMetadata.version);
    expect(serverManifest.version).toBe(packageMetadata.version);
    expect(serverManifest.name).toBe(packageMetadata.mcpName);
    expect(serverManifest.packages).toEqual([
      {
        identifier: packageMetadata.name,
        registryType: "npm",
        transport: { type: "stdio" },
        version: packageMetadata.version,
      },
    ]);
    expect(packageMetadata.private).toBe(false);
    expect(changelog).toContain(`## [${packageMetadata.version}] - 2026-08-27`);
  });
});
