import type { PageSize } from "../geometry/index.js";
import { z } from "zod";

export const PAGE_SIZE_PRESETS = {
  "a3-landscape": {
    height: { unit: "mm", value: 297 },
    width: { unit: "mm", value: 420 },
  },
  "a3-portrait": {
    height: { unit: "mm", value: 420 },
    width: { unit: "mm", value: 297 },
  },
  "a4-landscape": {
    height: { unit: "mm", value: 210 },
    width: { unit: "mm", value: 297 },
  },
  "a4-portrait": {
    height: { unit: "mm", value: 297 },
    width: { unit: "mm", value: 210 },
  },
  "letter-landscape": {
    height: { unit: "in", value: 8.5 },
    width: { unit: "in", value: 11 },
  },
  "letter-portrait": {
    height: { unit: "in", value: 11 },
    width: { unit: "in", value: 8.5 },
  },
} as const satisfies Record<string, PageSize>;

export type PageSizePreset = keyof typeof PAGE_SIZE_PRESETS;

/** Versioned schema for persisted page-preset references. */
export const pagePresetReferenceSchema = z
  .object({
    name: z.enum([
      "a3-landscape",
      "a3-portrait",
      "a4-landscape",
      "a4-portrait",
      "letter-landscape",
      "letter-portrait",
    ]),
    schema: z.literal("inkscape-mcp-page-preset/v1"),
  })
  .strict();

export function pageSizeFromPreset(preset: PageSizePreset): PageSize {
  const size = PAGE_SIZE_PRESETS[preset];
  return {
    height: { ...size.height },
    width: { ...size.width },
  };
}
