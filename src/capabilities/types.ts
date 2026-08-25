export type CapabilityObservation = {
  available: boolean;
  stderr: string;
};

export type ActionOrigin = "core" | "extension" | "unknown";
export type CapabilityAvailability = "available" | "absent" | "experimental";

export type ActionEvidence = {
  name: string;
  origin: ActionOrigin;
};

export type FlagCapability = {
  availability: CapabilityAvailability;
  name: string;
};

export type CapabilityCacheContext = {
  dataDirectories?: readonly string[];
  extensionDirectories?: readonly string[];
  helperPaths?: readonly string[];
  profileDirectory?: string;
};

export type InkscapeCapabilities = {
  actionCount: number;
  actionEvidence: readonly ActionEvidence[];
  actions: readonly string[];
  experimentalCapabilities: readonly string[];
  flags: readonly FlagCapability[];
  fingerprint: string;
  helpOptions: readonly string[];
  inputTypes: readonly string[];
  observations: Readonly<{
    actionList: CapabilityObservation;
    helpAll: CapabilityObservation;
    inputTypes: CapabilityObservation;
  }>;
  version: string;
};
