import { readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const MAX_DIRECT_SOURCE_ENTRIES = 25;
const SOURCE_FILE = /\.(?:cjs|css|cts|js|jsx|mjs|mts|svelte|ts|tsx)$/u;
const CLEAR_FOLDER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const VAGUE_FOLDER_NAMES = new Set(["common", "misc", "shared", "utils"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".svelte-kit",
  ".svn",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "dist-demo",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function inspectDirectory(repositoryRoot, directory, violations) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const sourceFileCount = entries.filter(
    (entry) => entry.isFile() && SOURCE_FILE.test(entry.name),
  ).length;
  let containsSource = sourceFileCount > 0;
  let sourceFolderCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || EXCLUDED_DIRECTORIES.has(entry.name))
      continue;
    const childContainsSource = inspectDirectory(
      repositoryRoot,
      join(directory, entry.name),
      violations,
    );
    if (childContainsSource) sourceFolderCount += 1;
    containsSource = childContainsSource || containsSource;
  }

  if (directory === repositoryRoot || !containsSource) return containsSource;
  const path = relative(repositoryRoot, directory);
  const name = basename(directory);
  if (!CLEAR_FOLDER_NAME.test(name) || VAGUE_FOLDER_NAMES.has(name)) {
    violations.push(
      `${path}: folder names must be specific lowercase kebab-case domain names; avoid generic names such as common, misc, shared, or utils`,
    );
  }
  const sourceEntryCount = sourceFileCount + sourceFolderCount;
  if (sourceEntryCount > MAX_DIRECT_SOURCE_ENTRIES) {
    violations.push(
      `${path}: ${sourceEntryCount} direct source entries exceeds ${MAX_DIRECT_SOURCE_ENTRIES}; split this folder by clear responsibility using specific lowercase kebab-case child folder names`,
    );
  }
  return containsSource;
}

/** Reports source-folder size and naming-policy violations for a repository. */
export function findFolderStructureViolations(repositoryRoot) {
  const violations = [];
  inspectDirectory(repositoryRoot, repositoryRoot, violations);
  return violations.sort();
}

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const violations = findFolderStructureViolations(repositoryRoot);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Folder structure policy OK.");
