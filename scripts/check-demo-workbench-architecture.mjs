import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".svelte"];

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(entryPath));
    else if (SOURCE_EXTENSIONS.includes(extname(entry.name))) files.push(entryPath);
  }
  return files.sort();
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const script of scriptBlocks(source)) {
    const sourceFile = ts.createSourceFile("workbench-policy.ts", script, ts.ScriptTarget.Latest);
    const visit = (node) => {
      const moduleSpecifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : undefined;
      if (moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)) {
        specifiers.push(moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return specifiers;
}

function scriptBlocks(source) {
  if (!source.includes("<script")) return [source];
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function resolvedLocalImport(sourcePath, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(sourcePath, "..", specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  return candidates.find(existsSync);
}

function workbenchPath(repositoryRoot, path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function dependencyViolations(repositoryRoot, files) {
  const violations = [];
  for (const sourcePath of files) {
    const from = workbenchPath(repositoryRoot, sourcePath);
    const source = readFileSync(sourcePath, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const targetPath = resolvedLocalImport(sourcePath, specifier);
      if (targetPath === undefined) continue;
      const to = workbenchPath(repositoryRoot, targetPath);
      if (from.includes("/ui/") && to.includes("/controllers/")) {
        violations.push(
          `${from}: UI must depend on the presentation port, not controller internals (${to})`,
        );
      }
      if (
        !from.endsWith("/start.ts") &&
        !from.includes("/controllers/") &&
        to.includes("/controllers/")
      ) {
        violations.push(
          `${from}: only the workbench composition root may depend on controllers (${to})`,
        );
      }
      if (!from.includes("/ui/") && to.includes("/ui/")) {
        violations.push(`${from}: workbench implementation must not depend on Svelte UI (${to})`);
      }
    }
  }
  return violations;
}

/** Finds enforced Svelte-facing demo/workbench ownership boundary violations. */
export function findDemoWorkbenchArchitectureViolations(repositoryRoot) {
  const files = filesUnder(join(repositoryRoot, "demo", "workbench"));
  return dependencyViolations(repositoryRoot, files).sort();
}

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const violations = findDemoWorkbenchArchitectureViolations(repositoryRoot);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Demo workbench architecture policy OK.");
