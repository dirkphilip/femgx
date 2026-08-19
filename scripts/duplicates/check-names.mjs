import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { collectSourceFiles, defaultScanRoot, parseSourceFile } from "./fingerprint.mjs";

const DEFAULT_IGNORE_PATH = resolve(import.meta.dirname, "name-ignores.json");

const DECLARATION_KINDS = new Map([
  [ts.SyntaxKind.InterfaceDeclaration, "interface"],
  [ts.SyntaxKind.TypeAliasDeclaration, "type"],
  [ts.SyntaxKind.ClassDeclaration, "class"],
  [ts.SyntaxKind.EnumDeclaration, "enum"],
  [ts.SyntaxKind.FunctionDeclaration, "function"],
  [ts.SyntaxKind.ModuleDeclaration, "namespace"],
]);

/** @typedef {"interface" | "type" | "class" | "enum" | "function" | "namespace"} DeclarationKind */

/**
 * @typedef {object} NameOccurrence
 * @property {string} name The declared identifier.
 * @property {DeclarationKind} kind The declaration kind.
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {number} line One-based declaration line.
 */

/**
 * @typedef {object} NameIgnoreEntry
 * @property {string} file Scan-root-relative file path.
 * @property {string} name Declared name to suppress.
 * @property {DeclarationKind | undefined} kind Optional kind filter.
 */

function collectDeclarations(sourcePath) {
  const source = parseSourceFile(sourcePath);
  /** @type {NameOccurrence[]} */
  const declarations = [];
  for (const statement of source.statements) {
    const kind = DECLARATION_KINDS.get(statement.kind);
    if (kind === undefined) continue;
    const name = statement.name?.text;
    if (name === undefined) continue;
    if (statement.kind === ts.SyntaxKind.ModuleDeclaration && !ts.isIdentifier(statement.name)) {
      continue;
    }
    const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
    declarations.push({ name, kind, sourcePath, line: position.line + 1 });
  }
  return declarations;
}

function declarationKey(name, kind, sourcePath) {
  return `${name}\u0000${kind}\u0000${sourcePath}`;
}

/**
 * Loads the configured ignore entries, or an empty list when no file exists.
 * @param {string | undefined} ignorePath Path to the ignore JSON file.
 * @returns {NameIgnoreEntry[]} Validated, normalized ignore entries.
 */
export function loadNameIgnoreEntries(ignorePath = DEFAULT_IGNORE_PATH) {
  if (!existsSync(ignorePath)) return [];
  const parsed = JSON.parse(readFileSync(ignorePath, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${ignorePath} must contain an "entries" array`);
  }
  return parsed.entries.map((entry) => {
    if (typeof entry.file !== "string" || typeof entry.name !== "string") {
      throw new Error(`${ignorePath} entries require string "file" and "name" properties`);
    }
    return {
      file: entry.file.replace(/\\/gu, "/"),
      name: entry.name,
      kind: entry.kind,
    };
  });
}

/**
 * Returns whether an occurrence is suppressed by an ignore entry.
 * @param {NameOccurrence} occurrence The declaration to test.
 * @param {string} root Absolute scan root used to relativize paths.
 * @param {NameIgnoreEntry[]} ignoreEntries Active ignore entries.
 */
function isIgnored(occurrence, root, ignoreEntries) {
  const relativePath = relative(root, occurrence.sourcePath).replace(/\\/gu, "/");
  return ignoreEntries.some(
    (entry) =>
      entry.file === relativePath &&
      entry.name === occurrence.name &&
      (entry.kind === undefined || entry.kind === occurrence.kind),
  );
}

/**
 * Reports top-level declaration names declared in more than one source file.
 * @param {string} root Absolute directory to scan.
 * @param {string | undefined} ignorePath Path to the ignore JSON file.
 * @returns {string[]} Sorted human-readable violation descriptions.
 */
export function findDuplicateNameViolations(root, ignorePath = DEFAULT_IGNORE_PATH) {
  const ignoreEntries = loadNameIgnoreEntries(ignorePath);
  /** @type {Map<string, NameOccurrence[]>} */
  const byName = new Map();

  for (const sourcePath of collectSourceFiles(root)) {
    const unique = new Set();
    for (const declaration of collectDeclarations(sourcePath)) {
      const key = declarationKey(declaration.name, declaration.kind, declaration.sourcePath);
      if (unique.has(key)) continue;
      unique.add(key);
      const occurrences = byName.get(declaration.name) ?? [];
      occurrences.push(declaration);
      byName.set(declaration.name, occurrences);
    }
  }

  const violations = [];
  for (const [name, occurrences] of byName) {
    const active = occurrences.filter((occurrence) => !isIgnored(occurrence, root, ignoreEntries));
    const distinctFiles = new Set(active.map(({ sourcePath }) => sourcePath));
    if (distinctFiles.size < 2) continue;
    const detail = active
      .map(({ kind, sourcePath, line }) => `  ${relative(root, sourcePath)}:${line} (${kind})`)
      .sort();
    violations.push(
      `"${name}" is declared in ${distinctFiles.size} file(s):\n${detail.join("\n")}`,
    );
  }

  return violations.sort();
}

function parseArgs(argv) {
  /** @type {{ root: string | undefined, ignorePath: string | undefined }} */
  const options = { root: undefined, ignorePath: undefined };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ignore") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error("--ignore requires a path");
      options.ignorePath = resolve(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (options.root === undefined) options.root = resolve(arg);
    else throw new Error(`Unexpected extra argument: ${arg}`);
  }
  return options;
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const { root, ignorePath } = parseArgs(process.argv);
  const scanRoot = root ?? defaultScanRoot(import.meta.dirname);
  const violations = findDuplicateNameViolations(scanRoot, ignorePath);
  if (violations.length > 0) console.log(violations.join("\n\n"));
}
