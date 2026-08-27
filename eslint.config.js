import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["scripts/**/*.mjs", "tests/fakes/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        setInterval: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
    },
  },
);
