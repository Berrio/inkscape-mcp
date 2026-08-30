import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [mode, ...argumentsList] = process.argv.slice(2);
const options = new Map();

for (let index = 0; index < argumentsList.length; index += 2) {
  options.set(argumentsList[index], argumentsList[index + 1]);
}

const outputPath = options.get("--output");

if (mode === "success") {
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "fake output", "utf8");
  }
  process.stdout.write("success\n");
  process.exit(0);
} else if (mode === "version") {
  process.stdout.write("Inkscape 1.4.4 (dcaf3e7, 2026-05-05)\n");
  process.exit(0);
} else if (mode === "error") {
  process.stderr.write("intentional failure\n");
  process.exit(17);
} else if (mode === "large-stdout" || mode === "large-stderr") {
  const stream = mode === "large-stdout" ? process.stdout : process.stderr;
  stream.write("x".repeat(128 * 1024));
  setInterval(() => stream.write("x".repeat(128 * 1024)), 10);
} else if (mode === "timeout") {
  setInterval(() => undefined, 1000);
} else if (mode === "ignore-termination") {
  process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 1000);
} else if (mode === "partial") {
  if (!outputPath) {
    throw new Error("--output is required for partial mode");
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "partial output", "utf8");
  process.exit(0);
} else if (mode === "tree") {
  const childPidPath = options.get("--child-pid");
  const grandchildPidPath = options.get("--grandchild-pid");
  if (!childPidPath || !grandchildPidPath) {
    throw new Error(
      "--child-pid and --grandchild-pid are required for tree mode",
    );
  }

  const child = spawn(
    process.execPath,
    [import.meta.filename, "tree-child", "--grandchild-pid", grandchildPidPath],
    { stdio: "ignore" },
  );
  mkdirSync(dirname(childPidPath), { recursive: true });
  writeFileSync(childPidPath, String(child.pid), "utf8");
  setInterval(() => undefined, 1000);
} else if (mode === "tree-child") {
  const grandchildPidPath = options.get("--grandchild-pid");
  if (!grandchildPidPath) {
    throw new Error("--grandchild-pid is required for tree-child mode");
  }

  const grandchild = spawn(
    process.execPath,
    [import.meta.filename, "timeout"],
    {
      stdio: "ignore",
    },
  );
  mkdirSync(dirname(grandchildPidPath), { recursive: true });
  writeFileSync(grandchildPidPath, String(grandchild.pid), "utf8");
  setInterval(() => undefined, 1000);
} else if (mode === "echo") {
  process.stdout.write(`${options.get("--value") ?? ""}\n`);
  process.exit(0);
} else {
  throw new Error(`Unknown fake mode ${mode}`);
}
