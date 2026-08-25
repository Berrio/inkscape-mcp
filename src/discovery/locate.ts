import { realpath, stat } from "node:fs/promises";

import type { ServerConfig } from "../config/index.js";
import type { ProcessRunner } from "../runner/index.js";

import {
  configuredCandidate,
  pathCandidates,
  queryWindowsMsix,
  queryWindowsRegistry,
  standardCandidates,
} from "./providers.js";
import type {
  CandidateLocation,
  DiscoveryReport,
  InkscapeCandidate,
} from "./types.js";

export type LocateOptions = {
  config: Pick<ServerConfig, "inkscapeBin">;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  runner: ProcessRunner;
};

export async function locateInkscape(
  options: LocateOptions,
): Promise<DiscoveryReport> {
  const env = options.env ?? process.env;
  const locations = [
    ...configuredCandidate(options.config.inkscapeBin),
    ...pathCandidates(env),
    ...standardCandidates(env),
    ...(await queryWindowsRegistry(options.runner, options.cwd)),
    ...(await queryWindowsMsix(options.runner, options.cwd)),
  ];

  const candidatesByPath = new Map<string, InkscapeCandidate>();
  const rejections = [];

  for (const location of locations) {
    try {
      const resolved = await realpath(location.executablePath);
      const metadata = await stat(resolved);
      if (!metadata.isFile()) {
        rejections.push({
          executablePath: location.executablePath,
          reason: "Candidate is not a file",
          source: location.source,
        });
        continue;
      }

      const key =
        process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
      const current = candidatesByPath.get(key);
      if (current) {
        candidatesByPath.set(key, {
          ...current,
          sources: [...new Set([...current.sources, location.source])].sort(),
        });
      } else {
        candidatesByPath.set(key, {
          executablePath: resolved,
          installKind: location.installKind,
          sources: [location.source],
        });
      }
    } catch {
      if (shouldReportMissingLocation(location)) {
        rejections.push(rejectionForMissingLocation(location));
      }
    }
  }

  return {
    candidates: [...candidatesByPath.values()].sort((left, right) =>
      left.executablePath.localeCompare(right.executablePath),
    ),
    rejections,
  };
}

function shouldReportMissingLocation(location: CandidateLocation): boolean {
  // PATH is intentionally broad. Reporting every directory that does not
  // contain Inkscape makes doctor diagnostics unusable without adding useful
  // remediation. Explicit and installer-derived locations remain observable.
  return location.source !== "path";
}

function rejectionForMissingLocation(location: CandidateLocation) {
  return {
    executablePath: location.executablePath,
    reason: "Candidate does not exist or cannot be resolved",
    source: location.source,
  };
}
