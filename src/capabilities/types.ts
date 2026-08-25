export type CapabilityObservation = {
  available: boolean;
  stderr: string;
};

export type InkscapeCapabilities = {
  actionCount: number;
  actions: readonly string[];
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
