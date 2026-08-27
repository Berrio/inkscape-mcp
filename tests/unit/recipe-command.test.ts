import { describe, expect, it } from "vitest";

import {
  AutonomousRecipeError,
  parseAutonomousRecipeArguments,
  readAutonomousRecipe,
} from "../../src/automation/recipe-command.js";

describe("autonomous recipe command", () => {
  it("reads a closed versioned recipe", async () => {
    await expect(
      readAutonomousRecipe("tests/fixtures/recipes/valid.json"),
    ).resolves.toEqual({
      operations: [
        { kind: "inspect" },
        {
          kind: "preflight",
          outputDirectory: "planned",
          preset: "plain-svg",
        },
        {
          kind: "export",
          outputDirectory: "exports",
          preset: "web-png",
        },
      ],
      schema: "inkscape-mcp-recipe/v1",
      source: "labels.svg",
      workspaceIndex: 0,
    });
  });

  it("requires a recipe path before ordinary server configuration", () => {
    expect(() => parseAutonomousRecipeArguments([])).toThrow(
      AutonomousRecipeError,
    );
    expect(
      parseAutonomousRecipeArguments([
        "recipe.json",
        "--workspace-root",
        "C:/designs",
      ]),
    ).toEqual({
      configArguments: ["--workspace-root", "C:/designs"],
      recipePath: "recipe.json",
    });
  });
});
