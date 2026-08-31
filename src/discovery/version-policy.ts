export type InkscapeSupportStatus = "experimental" | "stable" | "unsupported";

export type InkscapePageAdapter = "pages_v14";

export type InkscapeVersionSupport = {
  pageAdapter?: InkscapePageAdapter;
  status: InkscapeSupportStatus;
  warnings: readonly string[];
};

/**
 * Classifies an observed Inkscape release without treating a matching major or
 * minor number as proof of compatibility. The only stable combination is the
 * Windows 1.4.4 baseline that has real MCP smoke evidence.
 */
export function assessInkscapeVersion(
  version: string,
  platform: NodeJS.Platform = process.platform,
): InkscapeVersionSupport {
  const release = parseInkscapeRelease(version);
  if (!release)
    return {
      status: "unsupported",
      warnings: ["INKSCAPE_VERSION_UNPARSEABLE"],
    };

  if (
    platform === "win32" &&
    release.major === 1 &&
    release.minor === 4 &&
    release.patch === 4
  )
    return { pageAdapter: "pages_v14", status: "stable", warnings: [] };

  if (release.major === 1 && release.minor === 4)
    return {
      status: "experimental",
      warnings: [
        platform === "win32"
          ? "INKSCAPE_1_4_PATCH_UNVERIFIED"
          : "INKSCAPE_PLATFORM_UNVERIFIED",
      ],
    };

  if (release.major === 1 && release.minor >= 5)
    return {
      status: "experimental",
      warnings: [
        "INKSCAPE_1_5_EXPERIMENTAL",
        "PAGES_V15_NOT_IMPLEMENTED",
        ...(platform === "win32" ? [] : ["INKSCAPE_PLATFORM_UNVERIFIED"]),
      ],
    };

  return {
    status: "unsupported",
    warnings: ["INKSCAPE_VERSION_UNSUPPORTED"],
  };
}

function parseInkscapeRelease(
  version: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:\s|$)/u);
  if (!match) return undefined;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major: major!, minor: minor!, patch: patch! };
}
