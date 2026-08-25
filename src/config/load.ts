import { readFile } from "node:fs/promises";

import { ZodError } from "zod";

import {
  configInputSchema,
  DEFAULT_CONFIG,
  type ConfigInput,
  type ServerConfig,
  type ValidatedConfigInput,
} from "./schema.js";

export class ConfigurationError extends Error {
  public readonly code:
    "CONFIG_INVALID" | "CONFIG_UNREADABLE" | "WORKSPACE_NOT_CONFIGURED";

  public constructor(
    code: ConfigurationError["code"],
    message: string,
    public readonly details?: readonly string[],
  ) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}

export type ConfigLoadOptions = {
  configFile?: ConfigInput | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  flags?: ConfigInput | undefined;
};

export type ParsedConfigFlags = {
  configPath?: string | undefined;
  overrides: ConfigInput;
};

function parseIntegerEnvironment(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new ConfigurationError(
      "CONFIG_INVALID",
      `${name} must be a positive integer`,
    );
  }

  return Number(value);
}

function parseWorkspaceRoots(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    ) {
      throw new Error("not an array of strings");
    }
    return parsed;
  } catch {
    throw new ConfigurationError(
      "CONFIG_INVALID",
      "INKSCAPE_MCP_WORKSPACE_ROOTS must be a JSON array of strings",
    );
  }
}

export function configFromEnvironment(env: NodeJS.ProcessEnv): ConfigInput {
  const httpPort = parseIntegerEnvironment(
    "INKSCAPE_MCP_HTTP_PORT",
    env.INKSCAPE_MCP_HTTP_PORT,
  );
  const maxConcurrency = parseIntegerEnvironment(
    "INKSCAPE_MCP_MAX_CONCURRENCY",
    env.INKSCAPE_MCP_MAX_CONCURRENCY,
  );
  const processTimeoutMs = parseIntegerEnvironment(
    "INKSCAPE_MCP_PROCESS_TIMEOUT_MS",
    env.INKSCAPE_MCP_PROCESS_TIMEOUT_MS,
  );

  return compactConfig({
    http: httpPort === undefined ? undefined : { port: httpPort },
    inkscapeBin: env.INKSCAPE_BIN,
    maxConcurrency,
    processTimeoutMs,
    scratchRoot: env.INKSCAPE_MCP_SCRATCH_ROOT,
    transport: env.INKSCAPE_MCP_TRANSPORT as ConfigInput["transport"],
    workspaceRoots: parseWorkspaceRoots(env.INKSCAPE_MCP_WORKSPACE_ROOTS),
  });
}

export function parseConfigFlags(
  argumentsList: readonly string[],
): ParsedConfigFlags {
  const overrides: ConfigInput = {};
  let configPath: string | undefined;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];

    if (value === undefined) {
      throw new ConfigurationError(
        "CONFIG_INVALID",
        `Missing value for ${flag}`,
      );
    }

    switch (flag) {
      case "--config":
        configPath = value;
        index += 1;
        break;
      case "--transport":
        overrides.transport = value as ConfigInput["transport"];
        index += 1;
        break;
      case "--workspace-root":
        overrides.workspaceRoots = [...(overrides.workspaceRoots ?? []), value];
        index += 1;
        break;
      case "--scratch-root":
        overrides.scratchRoot = value;
        index += 1;
        break;
      case "--inkscape-bin":
        overrides.inkscapeBin = value;
        index += 1;
        break;
      case "--max-concurrency":
        overrides.maxConcurrency = Number(value);
        index += 1;
        break;
      case "--timeout-ms":
        overrides.processTimeoutMs = Number(value);
        index += 1;
        break;
      case "--http-port":
        overrides.http = { port: Number(value) };
        index += 1;
        break;
      default:
        throw new ConfigurationError(
          "CONFIG_INVALID",
          `Unknown configuration flag ${flag}`,
        );
    }
  }

  return { configPath, overrides };
}

export async function readConfigFile(path: string): Promise<ConfigInput> {
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error: unknown) {
    throw new ConfigurationError(
      "CONFIG_UNREADABLE",
      "Unable to read configuration file",
      [error instanceof Error ? error.message : "unknown filesystem error"],
    );
  }

  try {
    return JSON.parse(content) as ConfigInput;
  } catch (error: unknown) {
    throw new ConfigurationError(
      "CONFIG_INVALID",
      "Configuration file must contain valid JSON",
      [error instanceof Error ? error.message : "unknown JSON error"],
    );
  }
}

export async function loadConfigFromCli(
  argumentsList: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServerConfig> {
  const parsedFlags = parseConfigFlags(argumentsList);
  const configFile =
    parsedFlags.configPath === undefined
      ? undefined
      : await readConfigFile(parsedFlags.configPath);

  return loadConfig({ configFile, env, flags: parsedFlags.overrides });
}

export function loadConfig({
  configFile = {},
  env = {},
  flags = {},
}: ConfigLoadOptions = {}): ServerConfig {
  const validatedFile = validateSource("configuration file", configFile);
  const validatedEnvironment = validateSource(
    "environment",
    configFromEnvironment(env),
  );
  const validatedFlags = validateSource("flags", flags);
  const merged = mergeConfig(
    validatedFile,
    validatedEnvironment,
    validatedFlags,
  );

  return validateSource(
    "merged configuration",
    merged,
  ) as unknown as ServerConfig;
}

export function isWorkspaceReady(config: ServerConfig): boolean {
  return config.workspaceRoots.length > 0;
}

export function assertDocumentWorkspace(config: ServerConfig): void {
  if (!isWorkspaceReady(config)) {
    throw new ConfigurationError(
      "WORKSPACE_NOT_CONFIGURED",
      "Document tools require at least one configured workspace root",
    );
  }
}

function compactConfig(config: ConfigInput): ConfigInput {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as ConfigInput;
}

function mergeConfig(
  file: ValidatedConfigInput,
  environment: ValidatedConfigInput,
  flags: ValidatedConfigInput,
): ConfigInput {
  return {
    ...DEFAULT_CONFIG,
    ...file,
    ...environment,
    ...flags,
    http: {
      ...DEFAULT_CONFIG.http,
      ...file.http,
      ...environment.http,
      ...flags.http,
    },
  };
}

function validateSource(
  sourceName: string,
  source: ConfigInput,
): ValidatedConfigInput {
  try {
    return configInputSchema.parse(source);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const details = error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      );
      throw new ConfigurationError(
        "CONFIG_INVALID",
        `Invalid ${sourceName}`,
        details,
      );
    }
    throw error;
  }
}
