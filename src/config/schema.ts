import { z } from "zod";

const mebibyte = 1024 * 1024;

export const HARD_LIMITS = {
  maxArtifactBytes: 512 * mebibyte,
  maxConcurrency: 8,
  maxDecodedRasterBytes: 1024 * mebibyte,
  maxInlineBytes: 4 * mebibyte,
  maxInputBytes: 512 * mebibyte,
  maxOperationsPerCall: 1000,
  maxRasterMegapixels: 100,
  maxResourceReadBytes: 8 * mebibyte,
  maxStderrBytes: 16 * mebibyte,
  maxStdoutBytes: 16 * mebibyte,
  processTimeoutMs: 300_000,
} as const;

const configuredPath = z.string().trim().min(1).max(4096);
const positiveInteger = (maximum: number) =>
  z.number().int().min(1).max(maximum);

const httpInputSchema = z
  .strictObject({
    auth: z.literal("required").optional(),
    host: z.literal("127.0.0.1").optional(),
    port: z.number().int().min(1).max(65_535).optional(),
  })
  .optional();

export const configInputSchema = z.strictObject({
  backupPolicy: z.literal("on-in-place-mutation").optional(),
  externalResources: z.literal("deny").optional(),
  http: httpInputSchema,
  inkscapeBin: z.union([z.literal("auto"), configuredPath]).optional(),
  maxArtifactBytes: positiveInteger(HARD_LIMITS.maxArtifactBytes).optional(),
  maxConcurrency: positiveInteger(HARD_LIMITS.maxConcurrency).optional(),
  maxDecodedRasterBytes: positiveInteger(
    HARD_LIMITS.maxDecodedRasterBytes,
  ).optional(),
  maxInlineBytes: positiveInteger(HARD_LIMITS.maxInlineBytes).optional(),
  maxInputBytes: positiveInteger(HARD_LIMITS.maxInputBytes).optional(),
  maxOperationsPerCall: positiveInteger(
    HARD_LIMITS.maxOperationsPerCall,
  ).optional(),
  maxRasterMegapixels: positiveInteger(
    HARD_LIMITS.maxRasterMegapixels,
  ).optional(),
  maxResourceReadBytes: positiveInteger(
    HARD_LIMITS.maxResourceReadBytes,
  ).optional(),
  maxStderrBytes: positiveInteger(HARD_LIMITS.maxStderrBytes).optional(),
  maxStdoutBytes: positiveInteger(HARD_LIMITS.maxStdoutBytes).optional(),
  maximumSanitizeMode: z
    .enum(["strict", "preserve-local", "trusted"])
    .optional(),
  nativeInputPolicy: z.literal("trusted-local-only").optional(),
  overwriteDefault: z.literal(false).optional(),
  processTimeoutMs: positiveInteger(HARD_LIMITS.processTimeoutMs).optional(),
  scratchRoot: z.union([z.literal("auto"), configuredPath]).optional(),
  transport: z.enum(["stdio", "http"]).optional(),
  workspaceRoots: z.array(configuredPath).max(32).optional(),
});

export type ConfigInput = z.input<typeof configInputSchema>;
export type ValidatedConfigInput = z.output<typeof configInputSchema>;

export type ServerConfig = {
  backupPolicy: "on-in-place-mutation";
  externalResources: "deny";
  http: {
    auth: "required";
    host: "127.0.0.1";
    port: number;
  };
  inkscapeBin: "auto" | string;
  maxArtifactBytes: number;
  maxConcurrency: number;
  maxDecodedRasterBytes: number;
  maxInlineBytes: number;
  maxInputBytes: number;
  maxOperationsPerCall: number;
  maxRasterMegapixels: number;
  maxResourceReadBytes: number;
  maxStderrBytes: number;
  maxStdoutBytes: number;
  maximumSanitizeMode: "strict" | "preserve-local" | "trusted";
  nativeInputPolicy: "trusted-local-only";
  overwriteDefault: false;
  processTimeoutMs: number;
  scratchRoot: "auto" | string;
  transport: "stdio" | "http";
  workspaceRoots: string[];
};

export const DEFAULT_CONFIG: ServerConfig = {
  backupPolicy: "on-in-place-mutation",
  externalResources: "deny",
  http: {
    auth: "required",
    host: "127.0.0.1",
    port: 3000,
  },
  inkscapeBin: "auto",
  maxArtifactBytes: 200 * mebibyte,
  maxConcurrency: 2,
  maxDecodedRasterBytes: 512 * mebibyte,
  maxInlineBytes: 1 * mebibyte,
  maxInputBytes: 50 * mebibyte,
  maxOperationsPerCall: 100,
  maxRasterMegapixels: 100,
  maxResourceReadBytes: 4 * mebibyte,
  maxStderrBytes: 8 * mebibyte,
  maxStdoutBytes: 8 * mebibyte,
  maximumSanitizeMode: "preserve-local",
  nativeInputPolicy: "trusted-local-only",
  overwriteDefault: false,
  processTimeoutMs: 60_000,
  scratchRoot: "auto",
  transport: "stdio",
  workspaceRoots: [],
};
