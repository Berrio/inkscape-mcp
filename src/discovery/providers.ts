import { delimiter, join, win32 } from "node:path";

import type { ProcessRunner } from "../runner/index.js";

import type {
  CandidateLocation,
  CandidateSource,
  InstallKind,
} from "./types.js";

export function configuredCandidate(
  path: string | "auto",
): CandidateLocation[] {
  return path === "auto"
    ? []
    : [{ executablePath: path, installKind: "path", source: "configured" }];
}

export function pathCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): CandidateLocation[] {
  const pathValue = env.Path ?? env.PATH;
  if (!pathValue) {
    return [];
  }

  const separator = platform === "win32" ? ";" : delimiter;
  const names =
    platform === "win32"
      ? ["inkscape.exe", "inkscape.com", "inkscape"]
      : ["inkscape"];
  const joinForPlatform = platform === "win32" ? win32.join : join;

  return pathValue
    .split(separator)
    .filter((entry) => entry.length > 0)
    .flatMap((entry) =>
      names.map((name) =>
        candidate(joinForPlatform(entry, name), "path", "path"),
      ),
    );
}

export function standardCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): CandidateLocation[] {
  if (platform === "win32") {
    return windowsStandardCandidates(env);
  }
  if (platform === "darwin") {
    return [
      candidate(
        "/Applications/Inkscape.app/Contents/MacOS/inkscape",
        "app-bundle",
        "standard",
      ),
      candidate("/opt/homebrew/bin/inkscape", "system", "standard"),
      candidate("/usr/local/bin/inkscape", "system", "standard"),
    ];
  }
  return [
    candidate("/usr/bin/inkscape", "system", "standard"),
    candidate("/usr/local/bin/inkscape", "system", "standard"),
    candidate("/snap/bin/inkscape", "system", "standard"),
    candidate(
      "/var/lib/flatpak/exports/bin/org.inkscape.Inkscape",
      "system",
      "standard",
    ),
  ];
}

export function parseRegistryCandidates(
  output: string,
  source: CandidateSource = "registry",
): CandidateLocation[] {
  const discovered: CandidateLocation[] = [];

  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(\(Default\)|DisplayIcon|InstallLocation)\s+REG_\w+\s+(.+)$/iu,
    );
    if (!match) {
      continue;
    }

    const label = match[1];
    const rawValue = match[2];
    if (!label || !rawValue) {
      continue;
    }
    const value = normalizeRegistryValue(rawValue);
    if (!value || !/inkscape/iu.test(value)) {
      continue;
    }

    if (label === "InstallLocation") {
      discovered.push(
        candidate(win32.join(value, "bin", "inkscape.exe"), "system", source),
      );
      discovered.push(
        candidate(win32.join(value, "inkscape.exe"), "system", source),
      );
    } else {
      discovered.push(candidate(value, "system", source));
    }
  }

  return discovered;
}

export function appPathsCandidates(output: string): CandidateLocation[] {
  return parseRegistryCandidates(output, "app-paths");
}

export function parseMsixCandidates(payload: string): CandidateLocation[] {
  const parsed: unknown = JSON.parse(payload);
  const records = Array.isArray(parsed) ? parsed : [parsed];

  return records.flatMap((record) => {
    if (!isAppxRecord(record)) {
      return [];
    }
    return msixInstallLocationCandidates(record.InstallLocation);
  });
}

export function msixInstallLocationCandidates(
  installLocation: string,
): CandidateLocation[] {
  const relativePaths = [
    ["VFS", "ProgramFilesX64", "Inkscape", "bin", "inkscape.exe"],
    ["VFS", "ProgramFiles", "Inkscape", "bin", "inkscape.exe"],
    ["VFS", "ProgramFilesX86", "Inkscape", "bin", "inkscape.exe"],
    ["Inkscape", "bin", "inkscape.exe"],
  ];

  return relativePaths.map((parts) =>
    candidate(win32.join(installLocation, ...parts), "msix", "msix"),
  );
}

export async function queryWindowsRegistry(
  runner: ProcessRunner,
  cwd: string,
): Promise<CandidateLocation[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const queries = [
    [
      "query",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\inkscape.exe",
      "/ve",
    ],
    [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\inkscape.exe",
      "/ve",
    ],
    [
      "query",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "/s",
    ],
    [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "/s",
    ],
  ] as const;
  const candidates: CandidateLocation[] = [];

  for (const [index, args] of queries.entries()) {
    const result = await runner.run("reg.exe", {
      args,
      cwd,
      maxStderrBytes: 128 * 1024,
      maxStdoutBytes: 1024 * 1024,
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0 || result.stdoutTruncated) {
      continue;
    }

    const output = result.stdout.toString("utf8");
    candidates.push(
      ...(index < 2
        ? appPathsCandidates(output)
        : parseRegistryCandidates(output)),
    );
  }

  return candidates;
}

export async function queryWindowsMsix(
  runner: ProcessRunner,
  cwd: string,
): Promise<CandidateLocation[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const script =
    "Get-AppxPackage -Name '*Inkscape*' | Select-Object Name,Version,InstallLocation | ConvertTo-Json -Compress";
  const result = await runner.run("powershell.exe", {
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    cwd,
    maxStderrBytes: 128 * 1024,
    maxStdoutBytes: 1024 * 1024,
    timeoutMs: 10_000,
  });

  if (result.exitCode !== 0 || result.stdoutTruncated) {
    return [];
  }

  try {
    return parseMsixCandidates(result.stdout.toString("utf8"));
  } catch {
    return [];
  }
}

function windowsStandardCandidates(
  env: NodeJS.ProcessEnv,
): CandidateLocation[] {
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA,
  ].filter((value): value is string => value !== undefined && value.length > 0);
  const candidates: CandidateLocation[] = [];

  for (const root of roots) {
    candidates.push(
      candidate(
        win32.join(root, "Inkscape", "bin", "inkscape.exe"),
        "system",
        "standard",
      ),
    );
    candidates.push(
      candidate(
        win32.join(root, "Programs", "Inkscape", "bin", "inkscape.exe"),
        "system",
        "standard",
      ),
    );
  }

  return candidates;
}

function candidate(
  executablePath: string,
  installKind: InstallKind,
  source: CandidateSource,
): CandidateLocation {
  return { executablePath, installKind, source };
}

function normalizeRegistryValue(value: string): string | undefined {
  const withoutIconIndex = value.replace(/,\s*\d+\s*$/u, "").trim();
  const withoutQuotes = withoutIconIndex.replace(/^"|"$/gu, "").trim();
  return withoutQuotes.length > 0 ? withoutQuotes : undefined;
}

function isAppxRecord(value: unknown): value is { InstallLocation: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "InstallLocation" in value &&
    typeof value.InstallLocation === "string" &&
    value.InstallLocation.length > 0
  );
}
