const NATIVE_IMPORT_FORMATS = [
  { aliases: ["ai", "ai.svg"], format: "ai" },
  { aliases: ["eps"], format: "eps" },
  { aliases: ["ps"], format: "ps" },
  { aliases: ["emf"], format: "emf" },
  { aliases: ["wmf"], format: "wmf" },
  { aliases: ["xaml"], format: "xaml" },
  { aliases: ["dxf"], format: "dxf" },
] as const;

export type NativeImportGate = {
  advertisedTypes: readonly string[];
  format: (typeof NATIVE_IMPORT_FORMATS)[number]["format"];
  headless: "not-headless" | "not-validated" | "validated";
  status: "available" | "detected-but-blocked" | "not-detected";
};

export type NativeImportHeadlessStatus = NativeImportGate["headless"];
export type NativeImportHeadlessStatuses = Partial<
  Record<NativeImportGate["format"], NativeImportHeadlessStatus>
>;

/**
 * Reports formats that Inkscape advertises but the MCP does not expose until
 * their real headless conversion fixture has passed.
 */
export function inspectNativeImportGates(
  inputTypes: readonly string[],
  headlessStatuses: NativeImportHeadlessStatuses = {},
): NativeImportGate[] {
  const observed = new Set(inputTypes.map((type) => type.toLowerCase()));
  return NATIVE_IMPORT_FORMATS.map(({ aliases, format }) => {
    const advertisedTypes = aliases.filter((alias) => observed.has(alias));
    const headless = headlessStatuses[format] ?? "not-validated";
    return {
      advertisedTypes,
      format,
      headless,
      status:
        advertisedTypes.length === 0
          ? ("not-detected" as const)
          : headless === "validated"
            ? ("available" as const)
            : ("detected-but-blocked" as const),
    };
  });
}
