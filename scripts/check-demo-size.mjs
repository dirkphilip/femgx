import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const MAX_EFFECTIVE_LINES = 400;
const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const workbenchRoot = join(repositoryRoot, "demo", "workbench");

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.name.endsWith(".css")) files.push(path);
  }
  return files.sort();
}

function effectiveLineCount(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, (comment) =>
    comment.replace(/[^\n]/gu, ""),
  );
  return withoutComments.split("\n").filter((line) => line.trim() !== "").length;
}

const violations = [];
for (const path of filesUnder(workbenchRoot)) {
  const count = effectiveLineCount(readFileSync(path, "utf8"));
  if (count > MAX_EFFECTIVE_LINES) {
    violations.push(
      `${relative(repositoryRoot, path)}: ${count} effective CSS lines exceeds maximum ${MAX_EFFECTIVE_LINES}`,
    );
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Demo stylesheet size OK.");
