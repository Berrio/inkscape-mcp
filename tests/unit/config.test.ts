import { describe, expect, it } from "vitest";

import {
  assertDocumentWorkspace,
  configFromEnvironment,
  ConfigurationError,
  loadConfig,
  loadConfigFromCli,
  nativeSecurityPosture,
  parseConfigFlags,
  redactConfig,
} from "../../src/config/index.js";

describe("configuration", () => {
  it("allows doctor/startup configuration without a workspace", () => {
    const config = loadConfig();

    expect(config.workspaceRoots).toEqual([]);
    expect(redactConfig(config)).toMatchObject({
      workspaceReady: false,
      workspaceRootCount: 0,
    });
    expect(() => assertDocumentWorkspace(config)).toThrowError(
      ConfigurationError,
    );
  });

  it("uses flags over environment over file over defaults", () => {
    const config = loadConfig({
      configFile: {
        maxConcurrency: 3,
        transport: "http",
        workspaceRoots: ["C:/from-file"],
      },
      env: {
        INKSCAPE_MCP_MAX_CONCURRENCY: "4",
        INKSCAPE_MCP_TRANSPORT: "stdio",
        INKSCAPE_MCP_WORKSPACE_ROOTS: '["C:/from-environment"]',
      },
      flags: {
        maxConcurrency: 5,
        workspaceRoots: ["C:/from-flags"],
      },
    });

    expect(config.maxConcurrency).toBe(5);
    expect(config.transport).toBe("stdio");
    expect(config.workspaceRoots).toEqual(["C:/from-flags"]);
  });

  it("rejects unknown config keys and hard-limit violations", () => {
    expect(() =>
      loadConfig({ configFile: { unknown: true } as never }),
    ).toThrow("Invalid configuration file");
    expect(() => loadConfig({ flags: { maxConcurrency: 9 } })).toThrow(
      "Invalid flags",
    );
  });

  it("requires JSON workspace roots in the environment", () => {
    expect(() =>
      configFromEnvironment({ INKSCAPE_MCP_WORKSPACE_ROOTS: "C:/one;C:/two" }),
    ).toThrow("INKSCAPE_MCP_WORKSPACE_ROOTS must be a JSON array of strings");
  });

  it("parses only allowlisted configuration flags", () => {
    const parsed = parseConfigFlags([
      "--config",
      "custom.json",
      "--workspace-root",
      "C:/one",
      "--workspace-root",
      "C:/two",
      "--http-port",
      "4040",
    ]);

    expect(parsed).toEqual({
      configPath: "custom.json",
      overrides: {
        http: { port: 4040 },
        workspaceRoots: ["C:/one", "C:/two"],
      },
    });
    expect(() => parseConfigFlags(["--unsafe", "value"])).toThrow(
      "Unknown configuration flag",
    );
  });

  it("keeps HTTP local and authenticated when selected", () => {
    const config = loadConfig({ flags: { transport: "http" } });

    expect(config.http).toEqual({
      auth: "required",
      host: "127.0.0.1",
      port: 3000,
    });
    expect(() =>
      loadConfig({ flags: { http: { host: "0.0.0.0" } as never } }),
    ).toThrow("Invalid flags");
  });

  it("does not reveal configured filesystem paths in redacted output", () => {
    const redacted = redactConfig(
      loadConfig({
        flags: {
          inkscapeBin: "C:/private/inkscape.exe",
          scratchRoot: "C:/private/scratch",
          workspaceRoots: ["C:/private/workspace"],
        },
      }),
    );

    expect(JSON.stringify(redacted)).not.toContain("C:/private");
    expect(redacted).toMatchObject({
      inkscapeBin: "configured",
      scratchRoot: "configured",
      workspaceReady: true,
    });
  });

  it("reports the unsandboxed native-parser boundary explicitly", () => {
    const posture = nativeSecurityPosture(loadConfig());

    expect(posture).toMatchObject({
      nativeInputPolicy: "trusted-local-only",
      nativeParserIsolation: "none",
      securityLevel: "workspace-guarded-native-unsandboxed",
    });
    expect(posture.residualRisks.join(" ")).toContain("unsandboxed");
  });

  it("loads and validates the selected JSON configuration file", async () => {
    const validPath = "tests/fixtures/config/valid.json";
    const invalidJsonPath = "tests/fixtures/config/invalid-json.txt";
    const unknownPropertyPath = "tests/fixtures/config/unknown-property.json";

    await expect(
      loadConfigFromCli(["--config", validPath]),
    ).resolves.toMatchObject({
      maxConcurrency: 3,
      workspaceRoots: ["C:/fixture-workspace"],
    });
    await expect(
      loadConfigFromCli(["--config", invalidJsonPath]),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    await expect(
      loadConfigFromCli(["--config", unknownPropertyPath]),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
