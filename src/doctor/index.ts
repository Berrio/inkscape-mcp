import {
  CapabilityService,
  probeDxfExport,
  probeFxgExport,
  probeGplExport,
  probeSifExport,
  probeHpglExport,
  probeJpegExport,
  probePngExport,
  probeTiffExport,
  probeWebpExport,
  type InkscapeCapabilities,
} from "../capabilities/index.js";
import {
  isWorkspaceReady,
  nativeSecurityPosture,
  redactConfig,
  type NativeSecurityPosture,
  type RedactedConfig,
  type ServerConfig,
} from "../config/index.js";
import {
  locateInkscape,
  probeInkscapeCandidate,
  type CandidateRejection,
} from "../discovery/index.js";
import { ProcessRunner } from "../runner/index.js";

export type DoctorReport = {
  capabilities?: Pick<
    InkscapeCapabilities,
    "actionCount" | "helpOptions" | "inputTypes" | "observations"
  > & {
    extensionExporterCount?: number;
    versionSupport: InkscapeCapabilities["versionSupport"];
    warnings: readonly string[];
  };
  config: RedactedConfig;
  diagnostics: readonly string[];
  inkscape?: {
    installKind: string;
    sources: readonly string[];
    version: string;
  };
  pngExportProbe?: { available: boolean; reason?: string };
  dxfExportProbe?: { available: boolean; reason?: string };
  fxgExportProbe?: { available: boolean; reason?: string };
  gplExportProbe?: { available: boolean; reason?: string };
  sifExportProbe?: { available: boolean; reason?: string };
  hpglExportProbe?: { available: boolean; reason?: string };
  jpegExportProbe?: { available: boolean; reason?: string };
  tiffExportProbe?: { available: boolean; reason?: string };
  webpExportProbe?: { available: boolean; reason?: string };
  securityPosture: NativeSecurityPosture;
  workspaceReady: boolean;
};

export async function runDoctor(
  config: ServerConfig,
  cwd: string,
  dependencies: {
    capabilities?: CapabilityService;
    runner?: ProcessRunner;
  } = {},
): Promise<DoctorReport> {
  const runner =
    dependencies.runner ?? new ProcessRunner(config.maxConcurrency);
  const discovery = await locateInkscape({ config, cwd, runner });
  const diagnostics = discovery.rejections.map(redactRejection);

  for (const candidate of discovery.candidates) {
    const probe = await probeInkscapeCandidate(runner, candidate, cwd);
    if (!("version" in probe)) {
      diagnostics.push(redactRejection(probe));
      continue;
    }
    const capabilities = await (
      dependencies.capabilities ?? new CapabilityService()
    ).inspect(runner, candidate, probe.version, cwd);
    const pngExportProbe = await probePngExport(
      runner,
      candidate.executablePath,
      config,
    );
    const dxfExportProbe = await probeDxfExport(
      runner,
      candidate.executablePath,
      config,
    );
    const fxgExportProbe = await probeFxgExport(
      runner,
      candidate.executablePath,
      config,
    );
    const gplExportProbe = await probeGplExport(
      runner,
      candidate.executablePath,
      config,
    );
    const sifExportProbe = await probeSifExport(
      runner,
      candidate.executablePath,
      config,
    );
    const hpglExportProbe = await probeHpglExport(
      runner,
      candidate.executablePath,
      config,
    );
    const jpegExportProbe = await probeJpegExport(
      runner,
      candidate.executablePath,
      config,
    );
    const tiffExportProbe = await probeTiffExport(
      runner,
      candidate.executablePath,
      config,
    );
    const webpExportProbe = await probeWebpExport(
      runner,
      candidate.executablePath,
      config,
    );
    return {
      capabilities: {
        actionCount: capabilities.actionCount,
        extensionExporterCount: capabilities.extensionExporters.length,
        helpOptions: capabilities.helpOptions,
        inputTypes: capabilities.inputTypes,
        observations: capabilities.observations,
        versionSupport: capabilities.versionSupport,
        warnings: capabilities.warnings,
      },
      config: redactConfig(config),
      diagnostics,
      inkscape: {
        installKind: candidate.installKind,
        sources: candidate.sources,
        version: probe.version,
      },
      pngExportProbe,
      dxfExportProbe,
      fxgExportProbe,
      gplExportProbe,
      sifExportProbe,
      hpglExportProbe,
      jpegExportProbe,
      tiffExportProbe,
      webpExportProbe,
      securityPosture: nativeSecurityPosture(config),
      workspaceReady: isWorkspaceReady(config),
    };
  }

  return {
    config: redactConfig(config),
    diagnostics,
    securityPosture: nativeSecurityPosture(config),
    workspaceReady: isWorkspaceReady(config),
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    "Inkscape MCP doctor",
    `Workspace: ${report.workspaceReady ? "ready" : "not configured (document tools unavailable)"}`,
    `Inkscape: ${report.inkscape ? `${report.inkscape.version} (${report.inkscape.installKind})` : "not found"}`,
    `Security: ${report.securityPosture.securityLevel}; native parsers are unsandboxed (${report.securityPosture.nativeInputPolicy})`,
  ];
  if (report.capabilities) {
    lines.push(
      `Capabilities: ${report.capabilities.actionCount} actions, ${report.capabilities.inputTypes.length} input types, ${report.capabilities.helpOptions.length} options`,
    );
  }
  if (report.capabilities?.warnings.length) {
    lines.push(
      `Compatibility warnings: ${report.capabilities.warnings.join(", ")}`,
    );
  }
  if (report.pngExportProbe) {
    lines.push(
      `PNG export probe: ${report.pngExportProbe.available ? "passed" : `unavailable (${report.pngExportProbe.reason ?? "unknown reason"})`}`,
    );
  }
  if (report.diagnostics.length > 0) {
    lines.push(`Diagnostics: ${report.diagnostics.length} candidate issue(s)`);
  }
  lines.push(
    "Note: GTK warnings are preserved when observed; unknown native stderr is never silenced.",
  );
  return lines.join("\n");
}

function redactRejection(rejection: CandidateRejection): string {
  return `${rejection.source}: ${rejection.reason}`;
}
