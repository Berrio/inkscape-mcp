export function parseHelpOptions(output: string): string[] {
  return [
    ...new Set(
      [...output.matchAll(/(?<!\w)(--[a-z0-9][a-z0-9-]*)/giu)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
}

export function parseInputTypes(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/u)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => /^[a-z0-9][a-z0-9.+-]*$/u.test(line)),
    ),
  ].sort();
}

export function parseActionList(output: string): string[] {
  return [
    ...new Set(
      [...output.matchAll(/^\s*([a-z0-9][a-z0-9-]*)\s*:/gimu)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
}
