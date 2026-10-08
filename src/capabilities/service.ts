import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assessInkscapeVersion,
  type InkscapeCandidate,
} from "../discovery/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";
import { discoverInxExporters } from "../extensions/inx.js";

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
  "--export-filter-dpi",
  "--export-ignore-filters",
  "--export-latex",
  "--export-pdf-version",
  "--export-plain-svg",
  "--export-area-snap",
  "--export-png-antialias",
  "--export-png-color-mode",
  "--export-png-compression",
  "--export-png-use-dithering",
  "--export-type",
  "--export-text-to-path",
] as const;
const BASELINE_1_4_4_REQUIRED_FLAGS = [
  "--export-pdf-version",
  "--export-plain-svg",
  "--export-text-to-path",
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

    const [helpAll, inputTypes, actionList, extensionExporters] =
      await Promise.all([
        collect(runner, candidate.executablePath, ["--help-all"], cwd),
        collect(runner, candidate.executablePath, ["--list-input-types"], cwd),
        collect(runner, candidate.executablePath, ["--action-list"], cwd),
        discoverInxExporters(cacheContext.extensionDirectories ?? []),
      ]);
    const actions = actionList.available
      ? parseActionList(actionList.output)
      : [];
    const helpOptions = helpAll.available
      ? parseHelpOptions(helpAll.output)
      : [];
    const versionSupport = assessInkscapeVersion(version);
    const warnings = capabilityWarnings(
      versionSupport,
      helpAll.available,
      actionList.available,
      actions,
      helpOptions,
    );
    const value: InkscapeCapabilities = {
      actionCount: actions.length,
      actionEvidence: actions.map((name) => ({ name, origin: "unknown" })),
      actions,
      experimentalCapabilities: [],
      extensionExporters,
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
      versionSupport,
      warnings,
    };
    // A failed probe is an observation, not a stable property of the binary:
    // never cache it, so the next request can observe the recovered state.
    if (helpAll.available && inputTypes.available && actionList.available)
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

function capabilityWarnings(
  versionSupport: InkscapeCapabilities["versionSupport"],
  helpAvailable: boolean,
  actionListAvailable: boolean,
  actions: readonly string[],
  helpOptions: readonly string[],
): readonly string[] {
  const warnings = [...versionSupport.warnings];
  if (!helpAvailable) warnings.push("INKSCAPE_HELP_ALL_UNAVAILABLE");
  if (!actionListAvailable) warnings.push("INKSCAPE_ACTION_LIST_UNAVAILABLE");
  if (actionListAvailable && actions.length === 0)
    warnings.push("INKSCAPE_ACTION_LIST_EMPTY");
  if (versionSupport.status === "stable") {
    for (const flag of BASELINE_1_4_4_REQUIRED_FLAGS)
      if (!helpOptions.includes(flag))
        warnings.push(`INKSCAPE_1_4_4_FLAG_DRIFT:${flag}`);
  }
  return warnings;
}

type CollectedCommand = CapabilityObservation & { output: string };

/** Attempts per capability probe; Inkscape startup under concurrent load can
 * fail transiently, and a single miss would publish a misleading warning. */
const PROBE_ATTEMPTS = 2;

async function collect(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<CollectedCommand> {
  let attempt = await collectOnce(runner, executable, args, cwd);
  for (
    let count = 1;
    count < PROBE_ATTEMPTS && !attempt.available && attempt.retryable;
    count += 1
  )
    attempt = await collectOnce(runner, executable, args, cwd);
  return {
    available: attempt.available,
    output: attempt.output,
    stderr: attempt.stderr,
  };
}

async function collectOnce(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<CollectedCommand & { retryable: boolean }> {
  try {
    const result = await runner.run(executable, {
      args,
      cwd,
      maxStderrBytes: 128 * 1024,
      maxStdoutBytes: OUTPUT_LIMIT_BYTES,
      timeoutMs: 30_000,
    });
    const truncated = result.stdoutTruncated || result.stderrTruncated;
    return {
      available:
        result.exitCode === 0 &&
        result.terminationReason === "completed" &&
        !truncated,
      output: result.stdout.toString("utf8"),
      // An oversized listing is deterministic; retrying cannot change it.
      retryable: !truncated && result.terminationReason !== "aborted",
      stderr: result.stderr.toString("utf8"),
    };
  } catch (error: unknown) {
    return {
      available: false,
      output: "",
      retryable: false,
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
  const executableHash = await executableDigest(executablePath, metadata);
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

/**
 * Content hash of an executable, memoized by path, size and mtime. Every
 * capability lookup computes a fingerprint before consulting the cache, so
 * re-reading a large binary on each call would dominate tool latency; the
 * hash is recomputed only when the file's identity changes, and streamed
 * instead of loaded whole into memory.
 */
const executableDigests = new Map<
  string,
  { digest: Promise<string>; mtimeMs: number; size: number }
>();

function executableDigest(
  executablePath: string,
  metadata: { mtimeMs: number; size: number },
): Promise<string> {
  const cached = executableDigests.get(executablePath);
  if (
    cached !== undefined &&
    cached.size === metadata.size &&
    cached.mtimeMs === metadata.mtimeMs
  )
    return cached.digest;
  const digest = new Promise<string>((resolveDigest, reject) => {
    const hash = createHash("sha256");
    createReadStream(executablePath)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", () => resolveDigest(hash.digest("hex")));
  });
  executableDigests.set(executablePath, {
    digest,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  });
  // A failed read must not poison later lookups.
  digest.catch(() => executableDigests.delete(executablePath));
  return digest;
}

function defaultCacheContext(executablePath: string): CapabilityCacheContext {
  const profileDirectory =
    process.env.INKSCAPE_PROFILE_DIR ?? defaultProfileDirectory();
  return {
    dataDirectories: [dirname(executablePath)],
    extensionDirectories: [
      resolve(dirname(executablePath), "..", "share", "inkscape", "extensions"),
      ...(profileDirectory ? [resolve(profileDirectory, "extensions")] : []),
    ],
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
