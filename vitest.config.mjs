import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Many unit tests spawn real Node/stdio processes (CLI, runner, MCP
    // servers); on Windows each native run also starts the Job Object
    // launcher. Vitest's 5 s default is shorter than a process start on a
    // loaded machine, which made the suite fail intermittently without any
    // assertion being wrong. Tests that need longer still set their own.
    testTimeout: 20_000,
  },
});
