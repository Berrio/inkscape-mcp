import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  createAutonomousPresetPlan,
  executeAutonomousPresetPlan,
  inspectAutonomousSource,
  type AutonomousMcpSession,
  withAutonomousMcp,
} from "./export-command.js";
import { assertSafeRelativePath } from "../workspace/index.js";

const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    try {
      assertSafeRelativePath(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Path must be relative and safe",
      });
    }
  });
const presetSchema = z.enum([
  "print-a4-pdf",
  "print-pdf-300dpi",
  "web-png",
  "web-asset-pack",
  "plain-svg",
  "icon-pack",
]);
const recipeOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inspect") }).strict(),
  z
    .object({
      kind: z.literal("preflight"),
      outputDirectory: safeRelativePathSchema,
      preset: presetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("export"),
      outputDirectory: safeRelativePathSchema,
      preset: presetSchema,
    })
    .strict(),
]);
const recipeSchema = z
  .object({
    operations: z.array(recipeOperationSchema).min(1).max(20),
    schema: z.literal("inkscape-mcp-recipe/v1"),
    source: safeRelativePathSchema,
    workspaceIndex: z.number().int().min(0).max(31).default(0),
  })
  .strict();

export type AutonomousRecipe = z.output<typeof recipeSchema>;
export type AutonomousRecipeRequest = {
  configArguments: readonly string[];
  recipePath: string;
};

export class AutonomousRecipeError extends Error {
  public constructor(
    public readonly code: "RECIPE_EXECUTION_FAILED" | "RECIPE_INVALID",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "AutonomousRecipeError";
  }

  public get exitCode(): 2 | 3 {
    return this.code === "RECIPE_INVALID" ? 2 : 3;
  }
}

/** Parses `run <recipe.json>` while leaving only normal server config flags. */
export function parseAutonomousRecipeArguments(
  argumentsList: readonly string[],
): AutonomousRecipeRequest {
  const recipePath = argumentsList[0];
  if (recipePath === undefined || recipePath.startsWith("-"))
    throw new AutonomousRecipeError(
      "RECIPE_INVALID",
      "run requires one recipe JSON path before configuration flags",
    );
  return { configArguments: argumentsList.slice(1), recipePath };
}

export async function readAutonomousRecipe(
  recipePath: string,
): Promise<AutonomousRecipe> {
  let text: string;
  try {
    text = await readFile(recipePath, "utf8");
  } catch {
    throw new AutonomousRecipeError(
      "RECIPE_INVALID",
      "recipe file cannot be read",
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new AutonomousRecipeError(
      "RECIPE_INVALID",
      "recipe file must contain valid JSON",
    );
  }
  return parseAutonomousRecipe(input);
}

/** Validates an already-loaded recipe before it enters a durable queue. */
export function parseAutonomousRecipe(input: unknown): AutonomousRecipe {
  try {
    return recipeSchema.parse(input);
  } catch (error) {
    const details =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : "schema is invalid";
    throw new AutonomousRecipeError(
      "RECIPE_INVALID",
      details ?? "schema is invalid",
    );
  }
}

type PlannedOperation = {
  index: number;
  operation: Exclude<
    AutonomousRecipe["operations"][number],
    { kind: "inspect" }
  >;
  plan: Awaited<ReturnType<typeof createAutonomousPresetPlan>>;
};

/** Validates all recipe exports before consuming any plan or publishing output. */
export async function runAutonomousRecipe(
  request: AutonomousRecipeRequest,
  serverEntry: string,
): Promise<unknown> {
  const recipe = await readAutonomousRecipe(request.recipePath);
  return await runAutonomousRecipeDefinition(
    recipe,
    request.configArguments,
    serverEntry,
  );
}

/** Executes a validated stored recipe through the same private stdio MCP flow. */
export async function runAutonomousRecipeDefinition(
  recipe: AutonomousRecipe,
  configArguments: readonly string[],
  serverEntry: string,
): Promise<unknown> {
  try {
    return await withAutonomousMcp(
      {
        configArguments,
        workspaceIndex: recipe.workspaceIndex,
      },
      serverEntry,
      async (session) => await executeRecipe(session, recipe),
    );
  } catch (error) {
    if (error instanceof AutonomousRecipeError) throw error;
    throw new AutonomousRecipeError(
      "RECIPE_EXECUTION_FAILED",
      error instanceof Error ? error.message : "MCP recipe execution failed",
    );
  }
}

async function executeRecipe(
  session: AutonomousMcpSession,
  recipe: AutonomousRecipe,
): Promise<unknown> {
  const revision = await inspectAutonomousSource(session, recipe.source);
  const planned: PlannedOperation[] = [];
  const usedOutputPaths = new Set<string>();
  for (let index = 0; index < recipe.operations.length; index += 1) {
    const operation = recipe.operations[index]!;
    if (operation.kind === "inspect") continue;
    const plan = await createAutonomousPresetPlan(session, {
      ...operation,
      revision,
      source: recipe.source,
      ttlMs: 15 * 60 * 1_000,
    });
    if (operation.kind === "export")
      for (const outputPath of plan.outputPaths) {
        if (usedOutputPaths.has(outputPath))
          throw new AutonomousRecipeError(
            "RECIPE_INVALID",
            `export operations would publish the same output: ${outputPath}`,
          );
        usedOutputPaths.add(outputPath);
      }
    planned.push({ index, operation, plan });
  }

  const planByIndex = new Map(planned.map((entry) => [entry.index, entry]));
  const operations: unknown[] = [];
  for (let index = 0; index < recipe.operations.length; index += 1) {
    const operation = recipe.operations[index]!;
    if (operation.kind === "inspect") {
      operations.push({ kind: "inspect", revision, status: "completed" });
      continue;
    }
    const entry = planByIndex.get(index);
    if (entry === undefined) throw new Error("Recipe preflight is missing");
    const summary = {
      digest: entry.plan.digest,
      expiresAt: entry.plan.expiresAt,
      kind: operation.kind,
      outputDirectory: entry.plan.outputDirectory,
      outputPaths: entry.plan.outputPaths,
      preset: operation.preset,
      variantCount: entry.plan.variantCount,
    };
    if (operation.kind === "preflight") {
      operations.push({ ...summary, status: "planned" });
      continue;
    }
    const result = await executeAutonomousPresetPlan(
      session,
      entry.plan.planToken,
    );
    operations.push({ ...summary, ...result, status: "completed" });
  }
  return {
    operations,
    revision,
    schema: "inkscape-mcp-recipe-receipt/v1",
    source: recipe.source,
    workspaceIndex: recipe.workspaceIndex,
  };
}
