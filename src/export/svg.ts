import { readFile } from "node:fs/promises";
import { sanitizeSvg } from "../svg/index.js";
export async function verifySvg(path: string): Promise<void> {
  const source = await readFile(path, "utf8");
  sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
}
