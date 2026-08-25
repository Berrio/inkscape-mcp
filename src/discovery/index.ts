export { locateInkscape, type LocateOptions } from "./locate.js";
export { parseInkscapeVersion, probeInkscapeCandidate } from "./probe.js";
export {
  appPathsCandidates,
  configuredCandidate,
  msixInstallLocationCandidates,
  parseMsixCandidates,
  parseRegistryCandidates,
  pathCandidates,
  standardCandidates,
} from "./providers.js";
export type {
  CandidateLocation,
  CandidateRejection,
  CandidateSource,
  DiscoveryReport,
  InkscapeCandidate,
  InkscapeProbe,
  InstallKind,
} from "./types.js";
