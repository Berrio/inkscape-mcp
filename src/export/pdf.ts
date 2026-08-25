import { readFile } from "node:fs/promises";

export async function verifyPdf(path: string): Promise<{ version: string }> {
  const header = await readFile(path).then((value) =>
    value.subarray(0, 16).toString("ascii"),
  );
  const match = header.match(/^%PDF-(1\.[0-9])/u);
  if (!match) throw new Error("Export output is not a PDF");
  return { version: match[1]! };
}
