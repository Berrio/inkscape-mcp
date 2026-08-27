import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const npmCli = process.env.npm_execpath;

function npm(argumentsList) {
  if (!npmCli)
    throw new Error("npm_execpath is required to generate release evidence");
  return execFileSync(process.execPath, [npmCli, ...argumentsList], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function git(argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function resolveReleaseDirectory(input) {
  const directory = resolve(root, input);
  const rootRelative = relative(root, directory);
  if (
    rootRelative.length === 0 ||
    rootRelative.startsWith("..") ||
    isAbsolute(rootRelative)
  ) {
    throw new Error("Release output directory must stay below the repository");
  }
  return directory;
}

export function createChecksumText(artifacts) {
  return [...artifacts]
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map((artifact) => `${artifact.sha256} *${artifact.fileName}`)
    .join("\n")
    .concat("\n");
}

export function createProvenance({
  artifacts,
  commit,
  generatedAt,
  npmVersion,
}) {
  return {
    artifacts,
    build: {
      node: process.version,
      npm: npmVersion,
    },
    generatedAt,
    git: {
      commit,
      treeState: "clean",
    },
    package: {
      mcpName: packageMetadata.mcpName,
      name: packageMetadata.name,
      private: packageMetadata.private,
      version: packageMetadata.version,
    },
    schema: "inkscape-mcp-release-provenance/v1",
  };
}

function parseArguments(argumentsList) {
  if (argumentsList.length === 0)
    return `artifacts/releases/${packageMetadata.version}`;
  if (
    argumentsList.length === 2 &&
    argumentsList[0] === "--output-directory" &&
    argumentsList[1]
  ) {
    return argumentsList[1];
  }
  throw new Error("Usage: release-provenance.mjs [--output-directory <path>]");
}

function assertCleanGitTree() {
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  if (status) {
    throw new Error(
      "Release evidence requires a clean tracked Git tree; commit or revert changes first",
    );
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function generateReleaseEvidence(outputDirectoryInput) {
  assertCleanGitTree();
  const outputDirectory = resolveReleaseDirectory(outputDirectoryInput);
  if (existsSync(outputDirectory)) {
    throw new Error(
      `Release output directory already exists: ${outputDirectory}`,
    );
  }
  mkdirSync(dirname(outputDirectory), { recursive: true });
  mkdirSync(outputDirectory);

  const packedResult = JSON.parse(
    npm(["pack", "--json", "--pack-destination", outputDirectory]),
  );
  const [packed] = packedResult;
  if (!packed?.filename) throw new Error("npm pack did not return a tarball");

  const tarballPath = resolve(outputDirectory, basename(packed.filename));
  if (!existsSync(tarballPath))
    throw new Error("npm pack did not create its tarball");

  const sbomPath = resolve(
    outputDirectory,
    `${packageMetadata.name}-${packageMetadata.version}.spdx.json`,
  );
  writeJson(
    sbomPath,
    JSON.parse(
      npm(["sbom", "--sbom-format=spdx", "--package-lock-only", "--json"]),
    ),
  );

  const artifacts = [
    { fileName: basename(tarballPath), sha256: sha256(tarballPath) },
    { fileName: basename(sbomPath), sha256: sha256(sbomPath) },
  ];
  const provenancePath = resolve(
    outputDirectory,
    `${packageMetadata.name}-${packageMetadata.version}.provenance.json`,
  );
  writeJson(
    provenancePath,
    createProvenance({
      artifacts,
      commit: git(["rev-parse", "HEAD"]),
      generatedAt: new Date().toISOString(),
      npmVersion: npm(["--version"]).trim(),
    }),
  );

  const checksumArtifacts = [
    ...artifacts,
    { fileName: basename(provenancePath), sha256: sha256(provenancePath) },
  ];
  const checksumsPath = resolve(outputDirectory, "SHA256SUMS");
  writeFileSync(checksumsPath, createChecksumText(checksumArtifacts), "utf8");

  return {
    checksumsPath,
    outputDirectory,
    provenancePath,
    sbomPath,
    tarballPath,
  };
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    const result = generateReleaseEvidence(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unable to generate release evidence"}\n`,
    );
    process.exitCode = 1;
  }
}
