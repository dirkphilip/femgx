import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const demoRoot = join(repositoryRoot, "demo");
const benchmarkExemptions = new Set([
  "demo/benchmark/interactive.ts",
  "demo/benchmark/runner.ts",
  "demo/benchmark/model.ts",
  "demo/fixture/performance-fixture.ts",
]);
const importPattern = /(?:from|import\()\s*["']([^"']+)["']/gu;

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function isPublicRootImport(specifier) {
  return /(?:^|\/)src\/index$/u.test(specifier);
}

function findViolations() {
  const violations = [];
  for (const path of filesUnder(demoRoot)) {
    const relativePath = relative(repositoryRoot, path);
    if (benchmarkExemptions.has(relativePath)) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined || !/(?:^|\/)src\//u.test(specifier)) continue;
      if (isPublicRootImport(specifier)) continue;
      violations.push(`${relativePath}: unauthorized deep demo import ${specifier}`);
    }
  }
  return violations;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Demo import boundary OK.");
