import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  collectSourceFiles,
  defaultScanRoot,
  digestFingerprint,
  parseSourceFile,
  structuralFingerprint,
  typeShapeFingerprint,
  typeShapeFingerprintMembers,
} from "./fingerprint.mjs";

const DEFAULT_IGNORE_PATH = resolve(import.meta.dirname, "body-ignores.json");
const MIN_FINGERPRINT_LENGTH = 24;

const HASHABLE_TOP_LEVEL = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
]);

/** @typedef {"function" | "type" | "interface"} DeclarationKind */

/**
 * @typedef {object} DeclarationOccurrence
 * @property {string} name The declared identifier.
 * @property {DeclarationKind} kind The declaration kind.
 * @property {string} sourcePath Absolute path of the declaring file.
 * @property {number} line One-based declaration line.
 * @property {string} hash Structural digest of the declaration body.
 */

/**
 * @typedef {object} IgnoreEntry
 * @property {string} file Scan-root-relative file path.
 * @property {string} name Declared name to suppress.
 * @property {DeclarationKind | undefined} kind Optional kind filter.
 */

function declarationKindFor(node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  return undefined;
}

function hashFragmentFor(node) {
  if (ts.isFunctionDeclaration(node)) return node.body ?? undefined;
  if (ts.isTypeAliasDeclaration(node)) return node.type;
  if (ts.isInterfaceDeclaration(node)) return node.members;
  return undefined;
}

function declarationBodyFingerprint(node, kind) {
  const fragment = hashFragmentFor(node);
  if (fragment === undefined) return "";
  if (kind === "function") return structuralFingerprint(fragment);
  if (kind === "type") return typeShapeFingerprint(fragment);
  return typeShapeFingerprintMembers(fragment);
}

function collectHashableDeclarations(sourcePath) {
  const source = parseSourceFile(sourcePath);
  /** @type {DeclarationOccurrence[]} */
  const declarations = [];

  for (const statement of source.statements) {
    if (!HASHABLE_TOP_LEVEL.has(statement.kind)) continue;
    const name = statement.name?.text;
    const kind = declarationKindFor(statement);
    if (name === undefined || kind === undefined) continue;

    const fingerprint = declarationBodyFingerprint(statement, kind);
    if (fingerprint.length < MIN_FINGERPRINT_LENGTH) continue;

    const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
    declarations.push({
      name,
      kind,
      sourcePath,
      line: position.line + 1,
      hash: digestFingerprint(fingerprint),
    });
  }

  return declarations;
}

/**
 * Loads the configured ignore entries, or an empty list when no file exists.
 * @param {string | undefined} ignorePath Path to the ignore JSON file.
 * @returns {IgnoreEntry[]} Validated, normalized ignore entries.
 */
export function loadIgnoreEntries(ignorePath = DEFAULT_IGNORE_PATH) {
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
 * @param {DeclarationOccurrence} occurrence The declaration to test.
 * @param {string} root Absolute scan root used to relativize paths.
 * @param {IgnoreEntry[]} ignoreEntries Active ignore entries.
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
 * Reports whole-declaration bodies that are structurally identical across files.
 * @param {string} root Absolute directory to scan.
 * @param {string | undefined} ignorePath Path to the ignore JSON file.
 * @returns {string[]} Sorted human-readable violation descriptions.
 */
export function findDuplicateBodyViolations(root, ignorePath = DEFAULT_IGNORE_PATH) {
  const ignoreEntries = loadIgnoreEntries(ignorePath);
  /** @type {Map<string, DeclarationOccurrence[]>} */
  const byHash = new Map();

  for (const sourcePath of collectSourceFiles(root)) {
    for (const declaration of collectHashableDeclarations(sourcePath)) {
      const occurrences = byHash.get(declaration.hash) ?? [];
      occurrences.push(declaration);
      byHash.set(declaration.hash, occurrences);
    }
  }

  const violations = [];
  for (const occurrences of byHash.values()) {
    const active = occurrences.filter((occurrence) => !isIgnored(occurrence, root, ignoreEntries));
    const distinctFiles = new Set(active.map(({ sourcePath }) => sourcePath));
    if (active.length < 2 || distinctFiles.size < 2) continue;

    const kind = active[0]?.kind ?? "function";
    const detail = active
      .map(({ sourcePath, line, name }) => `  ${relative(root, sourcePath)}:${line} ${name}`)
      .sort();
    violations.push(`Same ${kind} body in ${distinctFiles.size} file(s):\n${detail.join("\n")}`);
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
  const violations = findDuplicateBodyViolations(scanRoot, ignorePath);
  if (violations.length > 0) console.log(violations.join("\n\n"));
}
