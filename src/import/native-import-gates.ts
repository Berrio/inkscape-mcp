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
  headless: "not-validated";
  status: "detected-but-blocked" | "not-detected";
};

/**
 * Reports formats that Inkscape advertises but the MCP does not expose until
 * their real headless conversion fixture has passed.
 */
export function inspectNativeImportGates(
  inputTypes: readonly string[],
): NativeImportGate[] {
  const observed = new Set(inputTypes.map((type) => type.toLowerCase()));
  return NATIVE_IMPORT_FORMATS.map(({ aliases, format }) => {
    const advertisedTypes = aliases.filter((alias) => observed.has(alias));
    return {
      advertisedTypes,
      format,
      headless: "not-validated" as const,
      status:
        advertisedTypes.length === 0
          ? ("not-detected" as const)
          : ("detected-but-blocked" as const),
    };
  });
}
