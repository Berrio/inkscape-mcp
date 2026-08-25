import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { InkscapeCandidate } from "../discovery/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";

import { parseActionList, parseHelpOptions, parseInputTypes } from "./parse.js";
import type {
  CapabilityCacheContext,
  CapabilityObservation,
  InkscapeCapabilities,
} from "./types.js";

const CACHE_TTL_MS = 5 * 60_000;
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const TRACKED_FLAGS = [
  "--export-margin",
  "--export-page",
  "--export-pdf-version",
  "--export-plain-svg",
  "--export-type",
] as const;

type CachedCapabilities = { expiresAt: number; value: InkscapeCapabilities };

export class CapabilityService {
  private readonly cache = new Map<string, CachedCapabilities>();

  public async inspect(
    runner: Pick<ProcessExecutor, "run">,
    candidate: InkscapeCandidate,
    version: string,
    cwd: string,
    cacheContext: CapabilityCacheContext = defaultCacheContext(
      candidate.executablePath,
    ),
  ): Promise<InkscapeCapabilities> {
    const fingerprint = await capabilityFingerprint(
      candidate.executablePath,
      version,
      cacheContext,
    );
    const cached = this.cache.get(fingerprint);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const [helpAll, inputTypes, actionList] = await Promise.all([
      collect(runner, candidate.executablePath, ["--help-all"], cwd),
      collect(runner, candidate.executablePath, ["--list-input-types"], cwd),
      collect(runner, candidate.executablePath, ["--action-list"], cwd),
    ]);
    const actions = actionList.available
      ? parseActionList(actionList.output)
      : [];
    const helpOptions = helpAll.available
      ? parseHelpOptions(helpAll.output)
      : [];
    const value: InkscapeCapabilities = {
      actionCount: actions.length,
      actionEvidence: actions.map((name) => ({ name, origin: "unknown" })),
      actions,
      experimentalCapabilities: [],
      flags: TRACKED_FLAGS.map((name) => ({
        availability: helpOptions.includes(name) ? "available" : "absent",
        name,
      })),
      fingerprint,
      helpOptions,
      inputTypes: inputTypes.available
        ? parseInputTypes(inputTypes.output)
        : [],
      observations: {
        actionList: observation(actionList),
        helpAll: observation(helpAll),
        inputTypes: observation(inputTypes),
      },
      version,
    };
    this.cache.set(fingerprint, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });
    return value;
  }

  public clear(): void {
    this.cache.clear();
  }
}

type CollectedCommand = CapabilityObservation & { output: string };

async function collect(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<CollectedCommand> {
  try {
    const result = await runner.run(executable, {
      args,
      cwd,
      maxStderrBytes: 128 * 1024,
      maxStdoutBytes: OUTPUT_LIMIT_BYTES,
      timeoutMs: 30_000,
    });
    return {
      available:
        result.exitCode === 0 &&
        result.terminationReason === "completed" &&
        !result.stdoutTruncated &&
        !result.stderrTruncated,
      output: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    };
  } catch (error: unknown) {
    return {
      available: false,
      output: "",
      stderr:
        error instanceof Error ? error.message : "unknown execution error",
    };
  }
}

function observation(result: CollectedCommand): CapabilityObservation {
  return { available: result.available, stderr: result.stderr };
}

async function capabilityFingerprint(
  executablePath: string,
  version: string,
  context: CapabilityCacheContext,
): Promise<string> {
  const metadata = await stat(executablePath);
  const executableHash = createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex");
  const contextPaths = [
    context.profileDirectory,
    ...(context.dataDirectories ?? []),
    ...(context.extensionDirectories ?? []),
    ...(context.helperPaths ?? []),
  ].filter((value): value is string => value !== undefined);
  const contextState = await Promise.all(
    [...new Set(contextPaths.map((path) => resolve(path)))]
      .sort()
      .map(pathState),
  );
  return createHash("sha256")
    .update(
      `${executablePath}\0${executableHash}\0${metadata.size}\0${metadata.mtimeMs}\0${version}\0${contextState.join("\0")}`,
    )
    .digest("hex");
}

function defaultCacheContext(executablePath: string): CapabilityCacheContext {
  const profileDirectory =
    process.env.INKSCAPE_PROFILE_DIR ?? defaultProfileDirectory();
  return {
    dataDirectories: [dirname(executablePath)],
    extensionDirectories: profileDirectory
      ? [resolve(profileDirectory, "extensions")]
      : [],
    helperPaths: [process.execPath],
    ...(profileDirectory === undefined ? {} : { profileDirectory }),
  };
}

function defaultProfileDirectory(): string | undefined {
  if (process.platform === "win32") {
    return process.env.APPDATA
      ? resolve(process.env.APPDATA, "inkscape")
      : undefined;
  }
  const root = process.env.XDG_CONFIG_HOME ?? process.env.HOME;
  return root
    ? resolve(
        root,
        process.env.XDG_CONFIG_HOME ? "inkscape" : ".config",
        "inkscape",
      )
    : undefined;
}

async function pathState(path: string): Promise<string> {
  try {
    const metadata = await stat(path);
    return `${path}:${metadata.isDirectory() ? "directory" : "file"}:${metadata.size}:${metadata.mtimeMs}`;
  } catch {
    return `${path}:missing`;
  }
}
