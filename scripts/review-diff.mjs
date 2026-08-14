import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_MODULE_THRESHOLD = 20;

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trimEnd();
}

function isProductionModule(path) {
  return /\.(?:ts|tsx|mts|cts)$/.test(path);
}

function sourceDirectory(path) {
  const parts = path.split("/");
  return parts[0] === "src" && parts.length > 2 ? parts.slice(0, -1).join("/") : undefined;
}

function moduleCounts(paths) {
  const counts = new Map();
  for (const path of paths) {
    if (!isProductionModule(path)) continue;
    const directory = sourceDirectory(path);
    if (!directory) continue;
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return counts;
}

function pathsFromGit(output) {
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function currentSourcePaths() {
  return pathsFromGit(
    git("ls-files", "--cached", "--others", "--exclude-standard", "--", "src"),
  ).filter((path) => existsSync(resolve(repositoryRoot, path)));
}

function addedSourceDirectories() {
  const status = git("status", "--porcelain=v1", "-z");
  const directories = new Set();
  const entries = status ? status.split("\0").filter(Boolean) : [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    let path = entry.slice(3);
    if (code.includes("R") || code.includes("C")) index += 1;
    if (!(code === "??" || code.includes("A") || code.includes("C") || code.includes("R"))) {
      continue;
    }
    if (!isProductionModule(path)) continue;
    const directory = sourceDirectory(path);
    if (directory) directories.add(directory);
  }
  return directories;
}

function printSourceModuleAdvisories() {
  const baseline = moduleCounts(
    pathsFromGit(git("ls-tree", "-r", "--name-only", "HEAD", "--", "src")),
  );
  const current = moduleCounts(currentSourcePaths());
  const directories = [...addedSourceDirectories()]
    .filter((directory) => {
      const currentCount = current.get(directory) ?? 0;
      const baselineCount = baseline.get(directory) ?? 0;
      return currentCount > SOURCE_MODULE_THRESHOLD && currentCount > baselineCount;
    })
    .sort();

  if (directories.length === 0) return;

  console.log("\nAdvisory source-directory module budget:");
  for (const directory of directories) {
    const count = current.get(directory);
    console.log(
      `- ${directory} has ${count} direct production TypeScript modules (threshold: ${SOURCE_MODULE_THRESHOLD}); review semantic ownership before adding a subdirectory.`,
    );
  }
}

const status = git("status", "--short");
const diffStat = git("diff", "--stat", "HEAD");

console.log("Ready-to-commit review\n");
console.log(status || "Working tree clean.");
console.log("\nTracked diff from HEAD:");
console.log(diffStat || "No tracked changes.");
console.log(
  "\nBefore finishing, check for unnecessary code, duplication, obsolete paths, and weakened tests.",
);
printSourceModuleAdvisories();
