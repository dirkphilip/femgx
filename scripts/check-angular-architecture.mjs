import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_ROOT = "demo/angular/src";
const COORDINATOR = "demo/angular/src/effects/viewport/viewport-coordinator.ts";
const PACKAGE_ENTRIES = new Set(["femgx", "femgx/model"]);

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (extname(entry.name) === ".ts") files.push(path);
  }
  return files.sort();
}

function importDeclarations(path) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return declarations;
}

function resolveLocalImport(path, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(path), specifier);
  const candidates = [base, `${base}.ts`, join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

function relativePath(repositoryRoot, path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function isInside(path, directory) {
  const child = relative(directory, path);
  return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
}

function importNames(declaration) {
  const bindings = declaration.importClause?.namedBindings;
  if (bindings === undefined) return [];
  if (ts.isNamespaceImport(bindings)) return ["*"];
  return bindings.elements.map((element) => element.propertyName?.text ?? element.name.text);
}

function layerViolation(from, to) {
  const fromLayer = from.slice(SOURCE_ROOT.length + 1).split("/")[0];
  const toLayer = to.slice(SOURCE_ROOT.length + 1).split("/")[0];
  if (fromLayer === "state" && toLayer !== "state") return "state must not import outward";
  if (fromLayer === "effects" && (toLayer === "app" || toLayer === "features"))
    return "effects must not import app or features";
  if (fromLayer === "features" && toLayer === "app") return "features must not import app";
  if (
    from.startsWith(`${SOURCE_ROOT}/features/`) &&
    basename(from).endsWith(".component.ts") &&
    (toLayer === "state" || toLayer === "effects")
  )
    return "components must depend on their feature facade";
  return undefined;
}

function findCycles(graph) {
  const violations = [];
  const visiting = new Set();
  const visited = new Set();
  const path = [];
  const visit = (node) => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      violations.push(`runtime dependency cycle: ${path.slice(start).concat(node).join(" -> ")}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    path.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return violations;
}

function inspectLocalTarget({ repositoryRoot, sourcePath, target, from, graph, violations }) {
  const to = relativePath(repositoryRoot, target);
  if (isInside(target, join(repositoryRoot, "src"))) {
    violations.push(`${from}: Angular must not reach src/ (${to})`);
  }
  if (/(?:^|\/)demo\/(?:workbench|devtools|benchmark)\//u.test(to)) {
    violations.push(`${from}: Angular must not import legacy demo/tooling (${to})`);
  }
  if (/(?:^|\/)(?:test|e2e)\//u.test(to)) {
    violations.push(`${from}: Angular must not import test/e2e code (${to})`);
  }
  if (!graph.has(target)) return;
  graph.get(sourcePath).push(target);
  const layerError = layerViolation(from, to);
  if (layerError !== undefined) violations.push(`${from}: ${layerError} (${to})`);
}

/** Finds Angular Gate 0 ownership and import violations. */
export function findAngularArchitectureViolations(repositoryRoot) {
  const angularRoot = join(repositoryRoot, SOURCE_ROOT);
  const files = filesUnder(angularRoot);
  const graph = new Map(files.map((path) => [path, []]));
  const violations = [];
  for (const path of files) {
    const from = relativePath(repositoryRoot, path);
    for (const declaration of importDeclarations(path)) {
      const specifier = declaration.moduleSpecifier.text;
      const target = resolveLocalImport(path, specifier);
      const names = importNames(declaration);
      if (specifier.startsWith("@/") || specifier.includes("/src/")) {
        violations.push(`${from}: Angular must not import source internals (${specifier})`);
      }
      if (target !== undefined) {
        inspectLocalTarget({ repositoryRoot, sourcePath: path, target, from, graph, violations });
      }
      if (specifier.startsWith("femgx/") && !PACKAGE_ENTRIES.has(specifier)) {
        violations.push(`${from}: Angular may only import published femgx entries (${specifier})`);
      }
      if (PACKAGE_ENTRIES.has(specifier) && from !== COORDINATOR) {
        violations.push(`${from}: only the viewport coordinator may import femgx (${specifier})`);
      }
      if (names.includes("createViewport") || names.includes("Viewport")) {
        if (from !== COORDINATOR) {
          violations.push(
            `${from}: only the viewport coordinator may own Viewport lifecycle symbols`,
          );
        }
      }
    }
  }
  return [...violations, ...findCycles(graph)].sort();
}

const repositoryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "..");
const violations = findAngularArchitectureViolations(repositoryRoot);
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("Angular architecture policy OK.");
