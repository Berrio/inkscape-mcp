import { z } from "zod";

import { exportPresetOverrideSchema } from "./spec.js";

const presetIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);

/** Versioned local definitions can inherit only bounded preset overrides. */
export const exportPresetDefinitionSchema = z
  .object({
    extends: presetIdSchema.optional(),
    id: presetIdSchema,
    overrides: exportPresetOverrideSchema.default({}),
    schema: z.literal("inkscape-mcp-export-preset-definition/v1"),
  })
  .strict();

export type ExportPresetDefinition = z.output<
  typeof exportPresetDefinitionSchema
>;

/** Resolves definitions deterministically and rejects unknown parents or cycles. */
export function resolveExportPresetDefinitions(
  input: readonly ExportPresetDefinition[],
): ReadonlyMap<string, ExportPresetDefinition["overrides"]> {
  const definitions = new Map<string, ExportPresetDefinition>();
  for (const definition of input) {
    if (definitions.has(definition.id))
      throw new Error("Preset definition IDs must be unique");
    definitions.set(definition.id, definition);
  }
  const resolved = new Map<string, ExportPresetDefinition["overrides"]>();
  const resolving = new Set<string>();
  const visit = (id: string): ExportPresetDefinition["overrides"] => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const definition = definitions.get(id);
    if (definition === undefined)
      throw new Error("Preset definition parent is unknown");
    if (resolving.has(id))
      throw new Error("Preset definition inheritance has a cycle");
    resolving.add(id);
    const parent =
      definition.extends === undefined ? {} : visit(definition.extends);
    const value = { ...parent, ...definition.overrides };
    resolving.delete(id);
    resolved.set(id, value);
    return value;
  };
  for (const id of definitions.keys()) visit(id);
  return resolved;
}
