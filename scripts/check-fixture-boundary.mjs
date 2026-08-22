import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const fixtureRoot = join(repositoryRoot, "fixtures");
const importPattern =
  /\b(?:from|import\s*\(|export\s+(?:\*|\{[^}]*\})\s+from)\s*["']([^"']+)["']/gu;
const packageSpecifiers = new Set(["femgx", "femgx/model"]);
const sourceFilePattern = /\.(?:cjs|cts|js|jsx|mjs|mts|svelte|ts|tsx)$/u;

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (sourceFilePattern.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function isInside(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function findViolations() {
  const violations = [];
  for (const path of filesUnder(fixtureRoot)) {
    const relativePath = relative(repositoryRoot, path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined || packageSpecifiers.has(specifier)) continue;
      if (specifier.startsWith(".")) {
        const target = resolve(path, "..", specifier);
        if (isInside(target, fixtureRoot)) continue;
      }
      violations.push(`${relativePath}: unauthorized fixture import ${specifier}`);
    }
  }

  for (const path of filesUnder(join(repositoryRoot, "src"))) {
    const relativePath = relative(repositoryRoot, path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier?.startsWith("fixtures/") || specifier?.includes("/fixtures/")) {
        violations.push(`${relativePath}: library source cannot import repository fixtures`);
      }
    }
  }
  return violations;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Fixture import boundary OK.");
