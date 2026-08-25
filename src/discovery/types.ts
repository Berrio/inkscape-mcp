export type CandidateSource =
  "app-paths" | "configured" | "msix" | "path" | "registry" | "standard";

export type InstallKind = "app-bundle" | "msix" | "path" | "system" | "unknown";

export type CandidateLocation = {
  executablePath: string;
  installKind: InstallKind;
  source: CandidateSource;
};

export type InkscapeCandidate = {
  executablePath: string;
  installKind: InstallKind;
  sources: readonly CandidateSource[];
};

export type CandidateRejection = {
  executablePath: string;
  reason: string;
  source: CandidateSource;
};

export type InkscapeProbe = {
  candidate: InkscapeCandidate;
  rawVersion: string;
  stderr: string;
  version: string;
};

export type DiscoveryReport = {
  candidates: readonly InkscapeCandidate[];
  rejections: readonly CandidateRejection[];
};
