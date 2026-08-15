import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (path.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

function documentedEntrypoints(packageJson) {
  return Object.keys(packageJson.exports)
    .filter((entry) => entry !== "./package.json")
    .map((entry) => (entry === "." ? "femgx" : `femgx${entry.slice(1)}`));
}

/** Returns documentation drift violations for the package's declared entries. */
export function findPublicEntryDocViolations(root = repositoryRoot) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entrypoints = documentedEntrypoints(packageJson);
  const chooserDocuments = [join(root, "README.md"), join(root, "docs/api-reference.md")];
  const documents = [
    ...chooserDocuments,
    ...filesUnder(join(root, "docs")),
    ...filesUnder(join(root, "wiki")),
  ];
  const sources = documents.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const violations = [];

  for (const entrypoint of entrypoints) {
    const tableMarker = new RegExp("\\\\|\\\\s*`" + entrypoint + "`\\\\s*\\\\|", "u");
    for (const path of chooserDocuments) {
      const source = readFileSync(path, "utf8");
      if (!tableMarker.test(source)) {
        violations.push(`${path}: missing documented entry ${entrypoint}`);
      }
    }
  }

  const packageImportPattern = /(?:from|require\()\s*["'](femgx(?:\/[^"']+)?)["']/gu;
  for (const { path, source } of sources) {
    for (const match of source.matchAll(packageImportPattern)) {
      const specifier = match[1];
      if (specifier !== undefined && !entrypoints.includes(specifier)) {
        violations.push(`${path}: undeclared package import ${specifier}`);
      }
    }
    if (/import[^\n]*\bimportGlb\b[^\n]*from\s*["']femgx["']/u.test(source)) {
      violations.push(`${path}: importGlb must use femgx/io/glb`);
    }
  }
  return violations;
}

const violations = findPublicEntryDocViolations();
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Public entry documentation OK.");
