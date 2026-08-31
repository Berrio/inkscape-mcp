export { locateInkscape, type LocateOptions } from "./locate.js";
export { parseInkscapeVersion, probeInkscapeCandidate } from "./probe.js";
export {
  assessInkscapeVersion,
  type InkscapePageAdapter,
  type InkscapeSupportStatus,
  type InkscapeVersionSupport,
} from "./version-policy.js";
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
